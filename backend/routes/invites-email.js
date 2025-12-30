/**
 * Add this code to the bottom of backend/routes/invites.js
 * OR import this module in server.js separately
 */

const { sendInviteEmail, getEmailServiceStatus } = require('../services/emailService');

/**
 * POST /api/invites/send-email
 * Send invite email to client
 * Protected: Advisors only
 */
router.post(
  '/send-email',
  requireSupabaseAuth,
  requireAdvisor,
  [
    body('inviteCode').trim().notEmpty().withMessage('Invite code is required')
  ],
  async (req, res) => {
    try {
      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { inviteCode } = req.body;
      const advisorId = req.user.id;

      const supabase = getDatabase();

      // Get invite code details
      const { data: invite, error: fetchError } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('code', inviteCode.toUpperCase())
        .eq('created_by', advisorId)
        .single();

      if (fetchError || !invite) {
        return res.status(404).json({
          success: false,
          error: 'Invite code not found'
        });
      }

      if (invite.is_used) {
        return res.status(400).json({
          success: false,
          error: 'Cannot send email for a used invite code'
        });
      }

      if (new Date(invite.expires_at) < new Date()) {
        return res.status(400).json({
          success: false,
          error: 'Cannot send email for an expired invite code'
        });
      }

      // Send email
      const result = await sendInviteEmail(
        invite.code,
        invite.client_name,
        invite.email
      );

      if (result.success) {
        res.json({
          success: true,
          message: `Invite email sent successfully to ${invite.email}`,
          provider: result.provider
        });
      } else {
        // Email provider not configured - return email content
        res.status(500).json({
          success: false,
          error: result.message,
          emailContent: result.emailContent,
          suggestion: 'Configure SENDGRID_API_KEY, RESEND_API_KEY, or SMTP settings in .env'
        });
      }
    } catch (error) {
      console.error('Error sending invite email:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send invite email',
        details: error.message
      });
    }
  }
);

/**
 * GET /api/invites/email-status
 * Check email service configuration status
 * Protected: Advisors only
 */
router.get(
  '/email-status',
  requireSupabaseAuth,
  requireAdvisor,
  async (req, res) => {
    try {
      const status = getEmailServiceStatus();

      res.json({
        success: true,
        ...status
      });
    } catch (error) {
      console.error('Error getting email status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get email status'
      });
    }
  }
);

// Export these routes to be added to invites.js
// OR you can add them directly to invites.js by copying the route handlers above
