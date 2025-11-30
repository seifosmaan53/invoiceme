-- Migration: Add PDF theme customization fields to user_settings table
-- Adds layout options, section toggles, and thank you message

-- Add PDF layout field (classic or minimal)
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS pdf_layout VARCHAR(20) DEFAULT 'classic';

-- Add section visibility toggles
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS pdf_show_logo BOOLEAN DEFAULT true;

ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS pdf_show_client_details BOOLEAN DEFAULT true;

ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS pdf_show_invoice_details BOOLEAN DEFAULT true;

ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS pdf_show_notes BOOLEAN DEFAULT true;

ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS pdf_show_footer BOOLEAN DEFAULT true;

-- Add customizable thank you message
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS pdf_thank_you_message TEXT;

-- Update existing rows to have default values
UPDATE user_settings 
SET 
  pdf_layout = COALESCE(pdf_layout, 'classic'),
  pdf_show_logo = COALESCE(pdf_show_logo, true),
  pdf_show_client_details = COALESCE(pdf_show_client_details, true),
  pdf_show_invoice_details = COALESCE(pdf_show_invoice_details, true),
  pdf_show_notes = COALESCE(pdf_show_notes, true),
  pdf_show_footer = COALESCE(pdf_show_footer, true)
WHERE pdf_layout IS NULL 
   OR pdf_show_logo IS NULL 
   OR pdf_show_client_details IS NULL 
   OR pdf_show_invoice_details IS NULL 
   OR pdf_show_notes IS NULL 
   OR pdf_show_footer IS NULL;

