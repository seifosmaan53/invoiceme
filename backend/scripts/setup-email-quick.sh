#!/bin/bash

# Quick Email Setup Script
# This script helps you set up email quickly on any device

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         InvoiceMe - Quick Email Setup                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from env.example..."
    if [ -f env.example ]; then
        cp env.example .env
        echo "✅ Created .env file"
    else
        echo "❌ env.example not found. Please create .env manually."
        exit 1
    fi
fi

echo ""
echo "Choose setup method:"
echo ""
echo "1. Automatic (Ethereal Email) - 30 seconds, no signup"
echo "2. Manual (Mailtrap) - 2 minutes, requires signup"
echo "3. Use saved credentials - Paste from password manager"
echo ""
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        echo ""
        echo "🚀 Running automatic setup..."
        npm run setup:email
        ;;
    2)
        echo ""
        echo "📧 Manual Mailtrap Setup"
        echo ""
        echo "1. Go to https://mailtrap.io and sign up (free)"
        echo "2. Create an inbox"
        echo "3. Go to inbox → SMTP Settings"
        echo "4. Copy the credentials"
        echo ""
        read -p "Press Enter when you have the credentials..."
        
        read -p "SMTP Host (default: sandbox.smtp.mailtrap.io): " smtp_host
        smtp_host=${smtp_host:-sandbox.smtp.mailtrap.io}
        
        read -p "SMTP Port (default: 2525): " smtp_port
        smtp_port=${smtp_port:-2525}
        
        read -p "SMTP Username: " smtp_user
        read -p "SMTP Password: " smtp_pass
        
        # Update .env file
        if grep -q "SMTP_HOST" .env; then
            sed -i.bak "s|SMTP_HOST=.*|SMTP_HOST=$smtp_host|" .env
            sed -i.bak "s|SMTP_PORT=.*|SMTP_PORT=$smtp_port|" .env
            sed -i.bak "s|SMTP_USER=.*|SMTP_USER=$smtp_user|" .env
            sed -i.bak "s|SMTP_PASS=.*|SMTP_PASS=$smtp_pass|" .env
        else
            echo "" >> .env
            echo "# Email/SMTP Configuration" >> .env
            echo "SMTP_HOST=$smtp_host" >> .env
            echo "SMTP_PORT=$smtp_port" >> .env
            echo "SMTP_USER=$smtp_user" >> .env
            echo "SMTP_PASS=$smtp_pass" >> .env
            echo "EMAIL_FROM=noreply@invoiceme.com" >> .env
            echo "FRONTEND_URL=http://localhost:8080" >> .env
            echo "SUPPORT_EMAIL=support@invoiceme.com" >> .env
        fi
        
        echo ""
        echo "✅ Email configuration added to .env"
        echo ""
        echo "💡 Save these credentials in your password manager:"
        echo "   Host: $smtp_host"
        echo "   Port: $smtp_port"
        echo "   User: $smtp_user"
        echo "   Pass: $smtp_pass"
        ;;
    3)
        echo ""
        echo "📋 Paste your saved credentials"
        echo ""
        read -p "SMTP Host: " smtp_host
        read -p "SMTP Port: " smtp_port
        read -p "SMTP Username: " smtp_user
        read -p "SMTP Password: " smtp_pass
        
        # Update .env file
        if grep -q "SMTP_HOST" .env; then
            sed -i.bak "s|SMTP_HOST=.*|SMTP_HOST=$smtp_host|" .env
            sed -i.bak "s|SMTP_PORT=.*|SMTP_PORT=$smtp_port|" .env
            sed -i.bak "s|SMTP_USER=.*|SMTP_USER=$smtp_user|" .env
            sed -i.bak "s|SMTP_PASS=.*|SMTP_PASS=$smtp_pass|" .env
        else
            echo "" >> .env
            echo "# Email/SMTP Configuration" >> .env
            echo "SMTP_HOST=$smtp_host" >> .env
            echo "SMTP_PORT=$smtp_port" >> .env
            echo "SMTP_USER=$smtp_user" >> .env
            echo "SMTP_PASS=$smtp_pass" >> .env
            echo "EMAIL_FROM=noreply@invoiceme.com" >> .env
            echo "FRONTEND_URL=http://localhost:8080" >> .env
            echo "SUPPORT_EMAIL=support@invoiceme.com" >> .env
        fi
        
        echo ""
        echo "✅ Email configuration added to .env"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "🧪 Testing email configuration..."
npm run test:email

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Restart your backend: npm run start:dev"
echo "   2. Test sending an email"
echo ""

