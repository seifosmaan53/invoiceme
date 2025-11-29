#!/bin/bash

# SMTP Development Setup Script
# Helps set up SMTP for development/testing

echo "📧 InvoiceMe - SMTP Development Setup"
echo "======================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from env.example..."
    cp env.example .env
    echo "✅ Created .env file"
    echo ""
fi

echo "Choose your SMTP provider for development:"
echo ""
echo "1) Mailtrap (Recommended for Development)"
echo "   - Free tier available"
echo "   - Catches all emails (no real sending)"
echo "   - Sign up at: https://mailtrap.io"
echo ""
echo "2) Ethereal Email (Quick Testing)"
echo "   - Instant account generation"
echo "   - No signup required"
echo "   - Visit: https://ethereal.email"
echo ""
echo "3) Gmail (Personal Testing)"
echo "   - Requires App Password"
echo "   - Generate at: https://myaccount.google.com/apppasswords"
echo ""
echo "4) Skip (Configure manually later)"
echo ""

read -p "Enter choice (1-4): " choice

case $choice in
    1)
        echo ""
        echo "📧 Mailtrap Setup"
        echo "================="
        echo ""
        echo "1. Sign up at https://mailtrap.io (free tier available)"
        echo "2. Create an inbox"
        echo "3. Go to inbox settings > SMTP Settings"
        echo "4. Copy the SMTP credentials"
        echo ""
        read -p "Enter SMTP Host (e.g., sandbox.smtp.mailtrap.io): " smtp_host
        read -p "Enter SMTP Port (usually 2525): " smtp_port
        read -p "Enter SMTP Username: " smtp_user
        read -p "Enter SMTP Password: " smtp_pass
        read -p "Enter From Email (e.g., noreply@invoiceme.com): " email_from
        
        # Update .env file
        if grep -q "^SMTP_HOST=" .env; then
            sed -i.bak "s|^SMTP_HOST=.*|SMTP_HOST=$smtp_host|" .env
            sed -i.bak "s|^SMTP_PORT=.*|SMTP_PORT=$smtp_port|" .env
            sed -i.bak "s|^SMTP_USER=.*|SMTP_USER=$smtp_user|" .env
            sed -i.bak "s|^SMTP_PASS=.*|SMTP_PASS=$smtp_pass|" .env
            sed -i.bak "s|^EMAIL_FROM=.*|EMAIL_FROM=$email_from|" .env
        else
            echo "" >> .env
            echo "# SMTP Configuration" >> .env
            echo "SMTP_HOST=$smtp_host" >> .env
            echo "SMTP_PORT=$smtp_port" >> .env
            echo "SMTP_USER=$smtp_user" >> .env
            echo "SMTP_PASS=$smtp_pass" >> .env
            echo "EMAIL_FROM=$email_from" >> .env
        fi
        
        echo ""
        echo "✅ Mailtrap SMTP configuration added to .env"
        echo ""
        echo "📝 Next steps:"
        echo "   1. Restart your backend server"
        echo "   2. Test with: node scripts/test-email.js your-email@example.com"
        echo "   3. Check Mailtrap inbox for test emails"
        ;;
    2)
        echo ""
        echo "📧 Ethereal Email Setup"
        echo "======================="
        echo ""
        echo "Visit https://ethereal.email to generate credentials"
        echo "Then run this script again and choose option 1 to enter them manually"
        echo ""
        ;;
    3)
        echo ""
        echo "📧 Gmail Setup"
        echo "============="
        echo ""
        echo "1. Enable 2-factor authentication on your Google account"
        echo "2. Generate App Password: https://myaccount.google.com/apppasswords"
        echo "3. Use the 16-character password (not your regular Gmail password)"
        echo ""
        read -p "Enter Gmail address: " smtp_user
        read -p "Enter App Password (16 characters): " smtp_pass
        read -p "Enter From Email (usually same as Gmail): " email_from
        
        # Update .env file
        if grep -q "^SMTP_HOST=" .env; then
            sed -i.bak "s|^SMTP_HOST=.*|SMTP_HOST=smtp.gmail.com|" .env
            sed -i.bak "s|^SMTP_PORT=.*|SMTP_PORT=587|" .env
            sed -i.bak "s|^SMTP_USER=.*|SMTP_USER=$smtp_user|" .env
            sed -i.bak "s|^SMTP_PASS=.*|SMTP_PASS=$smtp_pass|" .env
            sed -i.bak "s|^EMAIL_FROM=.*|EMAIL_FROM=$email_from|" .env
        else
            echo "" >> .env
            echo "# SMTP Configuration" >> .env
            echo "SMTP_HOST=smtp.gmail.com" >> .env
            echo "SMTP_PORT=587" >> .env
            echo "SMTP_USER=$smtp_user" >> .env
            echo "SMTP_PASS=$smtp_pass" >> .env
            echo "EMAIL_FROM=$email_from" >> .env
        fi
        
        echo ""
        echo "✅ Gmail SMTP configuration added to .env"
        echo ""
        echo "📝 Next steps:"
        echo "   1. Restart your backend server"
        echo "   2. Test with: node scripts/test-email.js your-email@example.com"
        ;;
    4)
        echo ""
        echo "⏭️  Skipping SMTP setup"
        echo ""
        echo "You can configure SMTP manually by editing .env file"
        echo "See docs/EMAIL_SETUP_COMPLETE.md for detailed instructions"
        ;;
    *)
        echo ""
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "📚 Documentation: docs/EMAIL_SETUP_COMPLETE.md"
echo ""

