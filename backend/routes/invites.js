/**
 * Invite Codes API Routes
 * Handles invite code generation, verification, and management
 */

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database-supabase');
const { requireSupabaseAuth, requireAdvisor } = require('../middleware/supabase-auth');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Sanitize user input for use in Supabase .or() PostgREST filter strings.
function sanitizePostgrestValue(value) {
  return value.replace(/[\\,.*()]/g, char => '\\' + char);
}

// Rate limiters
const inviteGenerateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 invites per 15 minutes
  message: 'Too many invite codes generated. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

const inviteVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // 30 verification attempts per 5 minutes
  message: 'Too many verification attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Generate a random invite code
 * Format: XXXX-YYYY (8 characters, excluding ambiguous chars)
 */
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O, I, 0, 1
  let code = '';

  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  code += '-';

  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return code;
}

// ============================================
// ADMIN ROUTES (Advisor only)
// ============================================

/**
 * POST /api/invites/generate
 * Generate a new invite code
 * Protected: Advisors only
 */
router.post(
  '/generate',
  requireSupabaseAuth,
  requireAdvisor,
  inviteGenerateLimiter,
  [
    body('clientName').trim().notEmpty().withMessage('Client name is required'),
    body('email').trim().isEmail().withMessage('Valid email is required')
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

      const { clientName, email } = req.body;
      const advisorId = req.user.id;

      const supabase = getDatabase();

      // Check if there's already an unused invite for this email
      const { data: existingInvite } = await supabase
        .from('invite_codes')
        .select('code, expires_at')
        .eq('email', email.toLowerCase())
        .eq('is_used', false)
        .gte('expires_at', new Date().toISOString())
        .single();

      if (existingInvite) {
        return res.status(400).json({
          success: false,
          error: 'An active invite code already exists for this email',
          existingCode: existingInvite.code,
          expiresAt: existingInvite.expires_at
        });
      }

      // Generate unique code
      let code;
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        code = generateInviteCode();

        // Check if code already exists
        const { data: existing } = await supabase
          .from('invite_codes')
          .select('id')
          .eq('code', code)
          .single();

        if (!existing) {
          isUnique = true;
        }

        attempts++;
      }

      if (!isUnique) {
        return res.status(500).json({
          success: false,
          error: 'Failed to generate unique code. Please try again.'
        });
      }

      // Create invite code
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

      const { data: inviteCode, error: createError } = await supabase
        .from('invite_codes')
        .insert([{
          code,
          email: email.toLowerCase(),
          client_name: clientName,
          created_by: advisorId,
          expires_at: expiresAt.toISOString()
        }])
        .select()
        .single();

      if (createError) {
        console.error('Error creating invite code:', createError);
        return res.status(500).json({
          success: false,
          error: 'Failed to create invite code'
        });
      }

      res.json({
        success: true,
        inviteCode: {
          id: inviteCode.id,
          code: inviteCode.code,
          email: inviteCode.email,
          clientName: inviteCode.client_name,
          expiresAt: inviteCode.expires_at,
          registrationUrl: `${process.env.FRONTEND_URL}/register?code=${inviteCode.code}`
        },
        message: 'Invite code generated successfully'
      });
    } catch (error) {
      console.error('Error generating invite code:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate invite code'
      });
    }
  }
);

/**
 * GET /api/invites
 * Get all invite codes created by the advisor
 * Protected: Advisors only
 */
router.get(
  '/',
  requireSupabaseAuth,
  requireAdvisor,
  async (req, res) => {
    try {
      const advisorId = req.user.id;
      const { status, search } = req.query;

      const supabase = getDatabase();

      let query = supabase
        .from('invite_codes')
        .select('*')
        .eq('created_by', advisorId)
        .order('created_at', { ascending: false });

      // Filter by status
      if (status === 'used') {
        query = query.eq('is_used', true);
      } else if (status === 'unused') {
        query = query.eq('is_used', false);
      } else if (status === 'expired') {
        query = query
          .eq('is_used', false)
          .lt('expires_at', new Date().toISOString());
      } else if (status === 'active') {
        query = query
          .eq('is_used', false)
          .gte('expires_at', new Date().toISOString());
      }

      // Search by name or email
      if (search) {
        query = query.or(
          `client_name.ilike.%${sanitizePostgrestValue(search)}%,email.ilike.%${sanitizePostgrestValue(search)}%`
        );
      }

      const { data: inviteCodes, error } = await query;

      if (error) {
        console.error('Error fetching invite codes:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch invite codes'
        });
      }

      res.json({
        success: true,
        inviteCodes: inviteCodes.map(invite => ({
          id: invite.id,
          code: invite.code,
          email: invite.email,
          clientName: invite.client_name,
          isUsed: invite.is_used,
          usedAt: invite.used_at,
          createdAt: invite.created_at,
          expiresAt: invite.expires_at,
          isExpired: new Date(invite.expires_at) < new Date() && !invite.is_used
        }))
      });
    } catch (error) {
      console.error('Error fetching invite codes:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch invite codes'
      });
    }
  }
);

/**
 * DELETE /api/invites/:code
 * Delete an invite code (only if unused)
 * Protected: Advisors only
 */
router.delete(
  '/:code',
  requireSupabaseAuth,
  requireAdvisor,
  async (req, res) => {
    try {
      const { code } = req.params;
      const advisorId = req.user.id;

      const supabase = getDatabase();

      // Check if invite exists and belongs to this advisor
      const { data: invite } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('code', code.toUpperCase())
        .eq('created_by', advisorId)
        .single();

      if (!invite) {
        return res.status(404).json({
          success: false,
          error: 'Invite code not found'
        });
      }

      if (invite.is_used) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete a used invite code'
        });
      }

      // Delete the invite
      const { error: deleteError } = await supabase
        .from('invite_codes')
        .delete()
        .eq('code', code.toUpperCase());

      if (deleteError) {
        console.error('Error deleting invite code:', deleteError);
        return res.status(500).json({
          success: false,
          error: 'Failed to delete invite code'
        });
      }

      res.json({
        success: true,
        message: 'Invite code deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting invite code:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete invite code'
      });
    }
  }
);

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

/**
 * GET /api/invites/verify/:code
 * Verify an invite code (public, for registration)
 * Rate limited to prevent abuse
 */
router.get(
  '/verify/:code',
  inviteVerifyLimiter,
  [
    param('code').trim().matches(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
      .withMessage('Invalid code format')
  ],
  async (req, res) => {
    try {
      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Invalid invite code format',
          details: errors.array()
        });
      }

      const { code } = req.params;
      const supabase = getDatabase();

      // Get invite code details
      const { data: invite } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('code', code.toUpperCase())
        .single();

      if (!invite) {
        return res.status(404).json({
          success: false,
          error: 'Invalid invite code',
          isValid: false
        });
      }

      // Check if already used
      if (invite.is_used) {
        return res.status(400).json({
          success: false,
          error: 'This invite code has already been used',
          isValid: false
        });
      }

      // Check if expired
      const now = new Date();
      const expiresAt = new Date(invite.expires_at);

      if (expiresAt < now) {
        return res.status(400).json({
          success: false,
          error: 'This invite code has expired',
          isValid: false
        });
      }

      // Code is valid
      res.json({
        success: true,
        isValid: true,
        invite: {
          email: invite.email,
          clientName: invite.client_name,
          expiresAt: invite.expires_at
        }
      });
    } catch (error) {
      console.error('Error verifying invite code:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify invite code'
      });
    }
  }
);

/**
 * POST /api/invites/mark-used
 * Mark an invite code as used (called during registration)
 * This is called by the signup process after creating the auth account
 */
router.post(
  '/mark-used',
  [
    body('code').trim().notEmpty().withMessage('Code is required'),
    body('email').trim().isEmail().withMessage('Valid email is required')
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

      const { code, email } = req.body;
      const supabase = getDatabase();

      // Get invite code
      const { data: invite } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('code', code.toUpperCase())
        .single();

      if (!invite) {
        return res.status(404).json({
          success: false,
          error: 'Invalid invite code'
        });
      }

      // Verify email matches
      if (invite.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(400).json({
          success: false,
          error: 'Email does not match invite code'
        });
      }

      // Check if already used
      if (invite.is_used) {
        return res.status(400).json({
          success: false,
          error: 'This invite code has already been used'
        });
      }

      // Check if expired
      if (new Date(invite.expires_at) < new Date()) {
        return res.status(400).json({
          success: false,
          error: 'This invite code has expired'
        });
      }

      // Mark as used
      const { error: updateError } = await supabase
        .from('invite_codes')
        .update({
          is_used: true,
          used_at: new Date().toISOString()
        })
        .eq('code', code.toUpperCase());

      if (updateError) {
        console.error('Error marking invite as used:', updateError);
        return res.status(500).json({
          success: false,
          error: 'Failed to mark invite as used'
        });
      }

      res.json({
        success: true,
        message: 'Invite code marked as used'
      });
    } catch (error) {
      console.error('Error marking invite as used:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark invite as used'
      });
    }
  }
);

module.exports = router;
