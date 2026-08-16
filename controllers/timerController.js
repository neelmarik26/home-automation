const schedule = require('node-schedule');
const WebSocket = require('ws');
const Timer = require('../models/Timer');
const ButtonState = require('../models/LAST5BUTTON');
const { getEspWebSocket, notifyButtonChange } = require('../websocket/connectionManager');

// In-memory map: timerId -> scheduledJob
const scheduledJobs = new Map();

async function scheduleTimer(timerDoc) {
  const job = schedule.scheduleJob(
    new Date(timerDoc.targetTime),
    async () => {
      await executeTimer(timerDoc);
    }
  );

  if (job) {
    scheduledJobs.set(timerDoc._id.toString(), job);
  }
}

async function executeTimer(timerDoc) {
  scheduledJobs.delete(timerDoc._id.toString());

  try {
    // Update button state
    const updatedButton = await ButtonState.findOneAndUpdate(
      { _id: timerDoc.buttonId, userId: timerDoc.userId },
      { state: timerDoc.action === 'ON' ? '1' : '0', timestamp: Date.now() },
      { new: true }
    );

    if (!updatedButton) return;

    // Mark timer as completed
    await Timer.updateOne({ _id: timerDoc._id }, { status: 'COMPLETED' });

    // Notify ESP via WebSocket
    const espWs = getEspWebSocket(timerDoc.userId);
    if (espWs && espWs.readyState === WebSocket.OPEN) {
      espWs.send(JSON.stringify({
        type: 'button_update',
        button: timerDoc.buttonName,
        status: timerDoc.action === 'ON' ? 1 : 0,
      }));
    }

    // Broadcast button change to all frontend clients
    notifyButtonChange(timerDoc.userId, timerDoc.buttonName, timerDoc.action === 'ON' ? 1 : 0);
  } catch (error) {
    console.error('Timer execution error:', error);
  }
}

// Load and reschedule all active timers on server start
async function loadActiveTimers() {
  try {
    const activeTimersDocs = await Timer.find({
      status: 'ACTIVE',
      targetTime: { $gt: new Date() },
    });

    activeTimersDocs.forEach(timer => {
      scheduleTimer(timer);
    });

    console.log(`[Timer] Loaded ${activeTimersDocs.length} active timers`);
  } catch (error) {
    console.error('[Timer] Failed to load active timers:', error);
  }
}

exports.loadActiveTimers = loadActiveTimers;

exports.createTimer = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { buttonId, buttonName, action, durationMinutes, targetTime: targetTimeStr } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'unauthorized' });
    }

    if (!buttonId || !buttonName || !action) {
      return res.status(400).json({
        message: 'buttonId, buttonName, and action are required',
      });
    }

    if (!['ON', 'OFF'].includes(action)) {
      return res.status(400).json({ message: 'action must be ON or OFF' });
    }

    let targetTime;
    let durationMins;

    if (targetTimeStr) {
      // Custom date/time mode
      targetTime = new Date(targetTimeStr);
      if (isNaN(targetTime.getTime())) {
        return res.status(400).json({ message: 'invalid target time' });
      }
      if (targetTime <= new Date()) {
        return res.status(400).json({ message: 'target time must be in the future' });
      }
      durationMins = Math.round((targetTime.getTime() - Date.now()) / 60000);
    } else if (durationMinutes) {
      // Duration mode
      if (durationMinutes < 1 || durationMinutes > 1440) {
        return res.status(400).json({ message: 'duration must be between 1 and 1440 minutes' });
      }
      targetTime = new Date(Date.now() + durationMinutes * 60 * 1000);
      durationMins = durationMinutes;
    } else {
      return res.status(400).json({ message: 'either durationMinutes or targetTime is required' });
    }

    // Cancel any existing active timer for the same button
    const existingActive = await Timer.findOne({
      userId,
      buttonId,
      status: 'ACTIVE',
    });
    if (existingActive) {
      const existingJob = scheduledJobs.get(existingActive._id.toString());
      if (existingJob) {
        existingJob.cancel();
        scheduledJobs.delete(existingActive._id.toString());
      }
      existingActive.status = 'CANCELLED';
      await existingActive.save();
    }

    const timerDoc = await Timer.create({
      userId,
      buttonId,
      buttonName,
      action,
      durationMinutes: durationMins,
      targetTime,
      status: 'ACTIVE',
    });

    scheduleTimer(timerDoc);

    return res.status(201).json({
      message: 'timer created',
      timer: {
        id: timerDoc._id,
        buttonId: timerDoc.buttonId,
        buttonName: timerDoc.buttonName,
        action: timerDoc.action,
        durationMinutes: timerDoc.durationMinutes,
        targetTime: timerDoc.targetTime,
        remainingMs: timerDoc.targetTime.getTime() - Date.now(),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to create timer', error: error.message });
  }
};

exports.getActiveTimers = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'unauthorized' });
    }

    const timers = await Timer.find({ userId, status: 'ACTIVE' }).sort({ targetTime: 1 });

    const result = timers.map(t => ({
      id: t._id,
      buttonId: t.buttonId,
      buttonName: t.buttonName,
      action: t.action,
      durationMinutes: t.durationMinutes,
      targetTime: t.targetTime,
      remainingMs: Math.max(0, t.targetTime.getTime() - Date.now()),
    }));

    return res.json({ timers: result });
  } catch (error) {
    return res.status(500).json({ message: 'failed to fetch timers', error: error.message });
  }
};

exports.cancelTimer = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { timerId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'unauthorized' });
    }

    if (!timerId) {
      return res.status(400).json({ message: 'timer id is required' });
    }

    const timer = await Timer.findOne({ _id: timerId, userId, status: 'ACTIVE' });
    if (!timer) {
      return res.status(404).json({ message: 'timer not found' });
    }

    const job = scheduledJobs.get(timerId);
    if (job) {
      job.cancel();
      scheduledJobs.delete(timerId);
    }

    timer.status = 'CANCELLED';
    await timer.save();

    return res.json({ message: 'timer cancelled', timerId });
  } catch (error) {
    return res.status(500).json({ message: 'failed to cancel timer', error: error.message });
  }
};
