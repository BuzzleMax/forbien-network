#!/usr/bin/env bash
# Deploy ForBien to GitHub Repository (Linux / macOS)
# Run this script after creating a new repository at: https://github.com/new

set -e

echo "========================================"
echo "ForBien GitHub Deployment Script (Linux)"
echo "========================================"
echo ""

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "Git is not initialized. Initializing..."
    git init
fi

REPO_NAME="forbien-network"

# Add or update remote origin
if git remote | grep -q "^origin$"; then
    echo "Updating remote origin..."
    # git remote set-url origin "https://github.com/YOUR_USERNAME/${REPO_NAME}.git"
else
    echo "Adding remote origin..."
    git remote add origin "https://github.com/YOUR_USERNAME/${REPO_NAME}.git"
fi

# Rename branch to main if needed
CURRENT_BRANCH=$(git branch --show-current || echo "")
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "Renaming branch to main..."
    git branch -M main
fi

echo "Pushing to GitHub..."
git push -u origin main || echo "Replace YOUR_USERNAME with your GitHub username in deploy-to-github.sh and try again."

echo ""
echo "========================================"
echo "Deployment Complete!"
echo "========================================"
echo ""
echo "The GitHub Actions workflow (.github/workflows/deploy.yml) will automatically"
echo "deploy the forbien-web/ landing page to the gh-pages branch when you push to main."
echo ""
echo "Next steps to activate GitHub Pages with custom domain:"
echo "1. Go to: https://github.com/YOUR_USERNAME/${REPO_NAME}/settings/pages"
echo "2. Wait for the 'gh-pages' branch to be created by the workflow (check Actions tab)."
echo "3. Under 'Build and deployment' -> 'Source', select 'Deploy from a branch'."
echo "4. Select 'gh-pages' branch and '/ (root)' folder."
echo "5. Click Save."
echo "6. In the 'Custom domain' field, enter: forbien.site"
echo "7. Create a DNS record (CNAME) at your DNS provider pointing forbien.site -> YOUR_USERNAME.github.io"
echo "8. Your site will be available at: https://forbien.site/"
echo ""
