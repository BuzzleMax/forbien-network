# Deploy ForBien to GitHub Repository
# Run this script after creating a new repository at: https://github.com/new

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "ForBien GitHub Deployment Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if git is initialized
if (-not (Test-Path ".git")) {
    Write-Host "Git is not initialized. Initializing..." -ForegroundColor Yellow
    git init
}

# Add remote origin (replace YOUR_USERNAME with your GitHub username)
$repoName = "forbien-network"
Write-Host "Adding remote origin..." -ForegroundColor Yellow
git remote add origin https://github.com/YOUR_USERNAME/$repoName.git

# Or if remote already exists, update it:
# git remote set-url origin https://github.com/YOUR_USERNAME/$repoName.git

# Rename branch to main if needed
$currentBranch = git branch --show-current
if ($currentBranch -ne "main") {
    Write-Host "Renaming branch to main..." -ForegroundColor Yellow
    git branch -M main
}

# Push to GitHub
Write-Host "Pushing to GitHub..." -ForegroundColor Yellow
git push -u origin main

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps to activate GitHub Pages:" -ForegroundColor Cyan
Write-Host "1. Go to: https://github.com/YOUR_USERNAME/$repoName/settings/pages" -ForegroundColor White
Write-Host "2. Under 'Source', select 'Deploy from a branch'" -ForegroundColor White
Write-Host "3. Select 'main' branch and '/ (root)' folder" -ForegroundColor White
Write-Host "4. Click Save" -ForegroundColor White
Write-Host "5. Your site will be available at: https://YOUR_USERNAME.github.io/$repoName/" -ForegroundColor White
Write-Host ""
