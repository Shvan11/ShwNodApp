#!/bin/bash
# Emergency Admin Password Reset - Linux/WSL/Mac Script
# Run this file to reset admin password

echo ""
echo "========================================"
echo "   EMERGENCY PASSWORD RESET"
echo "========================================"
echo ""
echo "This will reset the admin password."
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."
echo ""

npm run auth:emergency-reset

echo ""
echo "Script completed."
read -p "Press Enter to exit..."
