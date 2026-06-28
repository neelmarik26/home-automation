const SibApiV3Sdk = require('sib-api-v3-sdk');

function getEmailClient() {
  const apiKey = process.env.e_mail_api;

  if (!apiKey) {
    throw new Error('e_mail_api is missing from .env');
  }

  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  defaultClient.authentications['api-key'].apiKey = apiKey;

  return new SibApiV3Sdk.TransactionalEmailsApi();
}

async function sendOtpEmail(email, otp) {
  const apiInstance = getEmailClient();
  const senderName = process.env.EMAIL_SENDER_NAME || 'Neel from IoT';
  const senderEmail = process.env.EMAIL_SENDER_EMAIL;

  if (!senderEmail) {
    throw new Error('EMAIL_SENDER_EMAIL is missing from .env');
  }

  const sendSmtpEmail = {
    sender: {
      name: senderName,
      email: senderEmail,
    },
    to: [{ email }],
    subject: 'Your Verification Code',
    htmlContent: `<p>Hi there,</p><p>Your one-time verification code is:</p><h2 style="color:#2e6c80;">${otp}</h2><p>This code will expire in 10 minutes.</p><p>The IoT Team</p>`,
  };

  await apiInstance.sendTransacEmail(sendSmtpEmail);
}

module.exports = {
  sendOtpEmail,
};
