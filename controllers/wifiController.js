const crypto = require('crypto');

const WifiData = require('../models/wifiData');

function getEncryptionKey() {
  const secret = process.env.WIFI_DATA_SECRET;

  if (!secret) {
    throw new Error('WIFI_DATA_SECRET is missing from .env');
  }

  return crypto.createHash('sha256').update(secret).digest();
}

function encryptPassword(password) {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(password, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptPassword(payload) {
  const [ivHex, authTagHex, encryptedHex] = String(payload).split(':');

  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted password format');
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivHex, 'hex')
  );

  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

exports.storeWifiData = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { wifiName, wifiPassword } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'unauthorized' });
    }

    if (!wifiName || !wifiPassword) {
      return res.status(400).json({ message: 'wifiName and wifiPassword are required' });
    }

    const encryptedPassword = encryptPassword(wifiPassword);

    const wifiRecord = await WifiData.create({
      wifiName,
      wifiPassword: encryptedPassword,
      userId,
    });

    return res.status(201).json({
      message: 'wifi data stored successfully',
      data: {
        id: wifiRecord._id,
        wifiName: wifiRecord.wifiName,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'failed to store wifi data', error: error.message });
  }
};

exports.listWifiData = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'unauthorized' });
    }

    const wifiRecords = await WifiData.find({ userId }).sort({ createdAt: -1 });

    const data = wifiRecords.map((record) => ({
      id: record._id,
      wifiName: record.wifiName,
      wifiPassword: decryptPassword(record.wifiPassword),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }));

    return res.json({ userId, wifiData: data });
  } catch (error) {
    return res.status(500).json({ message: 'failed to fetch wifi data', error: error.message });
  }
};
