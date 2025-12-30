/**
 * Email Service for Sending Invite Emails
 * Supports multiple email providers (Supabase, SendGrid, Resend)
 */

const { getDatabase } = require('../database-supabase');

/**
 * Send invite email using Supabase Auth email
 * This uses Supabase's built-in email service
 */
async function sendInviteEmailSupabase(inviteCode, clientName, email) {
  const registrationUrl = `${process.env.FRONTEND_URL}/register?code=${inviteCode}`;
  const advisorName = process.env.ADVISOR_NAME || 'Your Financial Advisor';
  const companyName = process.env.COMPANY_NAME || 'Bautista Planning and Analytics';

  const supabase = getDatabase();

  // Supabase doesn't have a direct "send custom email" API
  // We'll need to use a third-party service or custom SMTP
  // For now, this is a placeholder showing the email structure

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background-color: #2c5282;
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 5px 5px 0 0;
        }
        .content {
          background-color: #f7fafc;
          padding: 30px;
          border: 1px solid #e2e8f0;
          border-top: none;
          border-radius: 0 0 5px 5px;
        }
        .invite-code {
          background-color: #fff;
          border: 2px dashed #2c5282;
          padding: 15px;
          text-align: center;
          font-size: 24px;
          font-weight: bold;
          letter-spacing: 2px;
          margin: 20px 0;
          color: #2c5282;
        }
        .button {
          display: inline-block;
          background-color: #2c5282;
          color: white;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 5px;
          margin: 20px 0;
        }
        .features {
          background-color: #fff;
          padding: 20px;
          margin: 20px 0;
          border-left: 4px solid #2c5282;
        }
        .features li {
          margin: 10px 0;
        }
        .footer {
          text-align: center;
          color: #718096;
          font-size: 12px;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>You're Invited!</h1>
        <p>Financial Progress Portal</p>
      </div>

      <div class="content">
        <p>Hi ${clientName},</p>

        <p>You've been invited to access your personalized <strong>Financial Progress Portal</strong>.</p>

        <p>Your exclusive invite code is:</p>

        <div class="invite-code">${inviteCode}</div>

        <p style="text-align: center;">
          <a href="${registrationUrl}" class="button">Register Now</a>
        </p>

        <div class="features">
          <p><strong>After registering, you'll be able to:</strong></p>
          <ul>
            <li>✓ Connect your bank accounts securely through Plaid</li>
            <li>✓ View automated monthly financial summaries</li>
            <li>✓ Track your income, expenses, and spending patterns</li>
            <li>✓ Access retirement projections and financial reports</li>
            <li>✓ Monitor your net worth and investment performance</li>
          </ul>
        </div>

        <p><strong>Getting Started:</strong></p>
        <ol>
          <li>Click the "Register Now" button above</li>
          <li>Enter your invite code: <code>${inviteCode}</code></li>
          <li>Complete your registration with a secure password</li>
          <li>Verify your email address</li>
          <li>Start connecting your accounts!</li>
        </ol>

        <p style="color: #718096; font-size: 14px;">
          <strong>Note:</strong> This invite code expires in 30 days and can only be used once.
        </p>

        <p>
          Best regards,<br>
          <strong>${advisorName}</strong><br>
          ${companyName}
        </p>
      </div>

      <div class="footer">
        <p>This is an automated message from ${companyName}.</p>
        <p>If you did not request this invitation, please disregard this email.</p>
      </div>
    </body>
    </html>
  `;

  const emailText = `
Hi ${clientName},

You've been invited to access your personalized Financial Progress Portal.

Your invite code is: ${inviteCode}

Register here: ${registrationUrl}

After registering, you'll be able to:
- Connect your bank accounts securely through Plaid
- View automated monthly financial summaries
- Track your income, expenses, and spending patterns
- Access retirement projections and financial reports
- Monitor your net worth and investment performance

Getting Started:
1. Click the registration link above
2. Enter your invite code: ${inviteCode}
3. Complete your registration with a secure password
4. Verify your email address
5. Start connecting your accounts!

Note: This invite code expires in 30 days and can only be used once.

Best regards,
${advisorName}
${companyName}

---
This is an automated message from ${companyName}.
If you did not request this invitation, please disregard this email.
  `;

  return {
    to: email,
    subject: "You're invited to Financial Progress Portal",
    html: emailHtml,
    text: emailText
  };
}

/**
 * Send invite email using SendGrid (recommended for production)
 * Install: npm install @sendgrid/mail
 * Set environment variable: SENDGRID_API_KEY
 */
async function sendInviteEmailSendGrid(inviteCode, clientName, email) {
  try {
    // Check if SendGrid is configured
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error('SendGrid API key not configured');
    }

    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const emailContent = await sendInviteEmailSupabase(inviteCode, clientName, email);

    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@yourdomain.com',
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html
    };

    await sgMail.send(msg);

    console.log(`✉️  Invite email sent to ${email} via SendGrid`);
    return { success: true, provider: 'sendgrid' };
  } catch (error) {
    console.error('SendGrid email error:', error);
    throw error;
  }
}

/**
 * Send invite email using Resend (modern alternative to SendGrid)
 * Install: npm install resend
 * Set environment variable: RESEND_API_KEY
 */
async function sendInviteEmailResend(inviteCode, clientName, email) {
  try {
    // Check if Resend is configured
    if (!process.env.RESEND_API_KEY) {
      throw new Error('Resend API key not configured');
    }

    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const emailContent = await sendInviteEmailSupabase(inviteCode, clientName, email);

    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
      to: email,
      subject: emailContent.subject,
      html: emailContent.html
    });

    if (error) {
      throw error;
    }

    console.log(`✉️  Invite email sent to ${email} via Resend`);
    return { success: true, provider: 'resend', emailId: data.id };
  } catch (error) {
    console.error('Resend email error:', error);
    throw error;
  }
}

/**
 * Send invite email using NodeMailer with custom SMTP
 * Install: npm install nodemailer
 * Set environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 */
async function sendInviteEmailSMTP(inviteCode, clientName, email) {
  try {
    const nodemailer = require('nodemailer');

    // Create SMTP transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const emailContent = await sendInviteEmailSupabase(inviteCode, clientName, email);

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || '"Financial Portal" <noreply@yourdomain.com>',
      to: email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html
    });

    console.log(`✉️  Invite email sent to ${email} via SMTP: ${info.messageId}`);
    return { success: true, provider: 'smtp', messageId: info.messageId };
  } catch (error) {
    console.error('SMTP email error:', error);
    throw error;
  }
}

/**
 * Main function to send invite email
 * Automatically selects the best available provider based on environment variables
 */
async function sendInviteEmail(inviteCode, clientName, email) {
  try {
    // Try providers in order of preference
    if (process.env.SENDGRID_API_KEY) {
      return await sendInviteEmailSendGrid(inviteCode, clientName, email);
    } else if (process.env.RESEND_API_KEY) {
      return await sendInviteEmailResend(inviteCode, clientName, email);
    } else if (process.env.SMTP_HOST) {
      return await sendInviteEmailSMTP(inviteCode, clientName, email);
    } else {
      // No email provider configured - return email content for manual sending
      console.warn('⚠️  No email provider configured. Returning email content for manual sending.');

      const emailContent = await sendInviteEmailSupabase(inviteCode, clientName, email);

      return {
        success: false,
        provider: 'none',
        message: 'No email provider configured. Use SENDGRID_API_KEY, RESEND_API_KEY, or SMTP settings.',
        emailContent: emailContent
      };
    }
  } catch (error) {
    console.error('Error sending invite email:', error);
    throw error;
  }
}

/**
 * Get email service status
 * Returns which email provider is configured and available
 */
function getEmailServiceStatus() {
  const providers = [];

  if (process.env.SENDGRID_API_KEY) {
    providers.push({ name: 'SendGrid', configured: true, priority: 1 });
  }

  if (process.env.RESEND_API_KEY) {
    providers.push({ name: 'Resend', configured: true, priority: 2 });
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    providers.push({ name: 'SMTP', configured: true, priority: 3 });
  }

  return {
    hasProvider: providers.length > 0,
    providers: providers.length > 0 ? providers : [{ name: 'None', configured: false }],
    activeProvider: providers.length > 0 ? providers[0].name : 'None'
  };
}

module.exports = {
  sendInviteEmail,
  getEmailServiceStatus
};
