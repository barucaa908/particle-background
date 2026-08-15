<#
  publish-github.ps1 —— 一键发布到 GitHub
  =========================================
  用法：
    # 方式 A：已安装 GitHub CLI 并登录
    .\publish-github.ps1

    # 方式 B：提供个人访问令牌（PAT，勾选 repo 权限）
    $env:GH_TOKEN = "ghp_xxxx"
    .\publish-github.ps1

  可选参数：
    -RepoName xxx        仓库名（默认 particle-background）
    -Visibility private  仓库可见性（默认 public）
#>
param(
  [string]$RepoName = "particle-background",
  [ValidateSet("public", "private")] [string]$Visibility = "public",
  [string]$Token = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DESCRIPTION = "Interactive constellation particle background - browser extension & DeepSeek Harness GUI beautifier. 星座连线粒子背景。"

function Fail([string]$msg) { Write-Host "[发布] 失败: $msg" -ForegroundColor Red; exit 1 }

# 1) git 是否可用（winget 装完需重开终端，或直接用完整路径）
$git = "git"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  $candidates = @("$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe")
  $git = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $git) { Fail "未找到 git，请先安装 Git for Windows（winget install --id Git.Git -e）并重开终端" }
}

# 2) 本地仓库已初始化且有提交
if (-not (Test-Path "$repoRoot\.git")) { Fail "本地仓库未初始化（应已由初始化脚本完成），请先运行 git init -b main && git add -A && git commit" }
$commitCount = & $git -C $repoRoot rev-list --count HEAD 2>$null
if (-not $commitCount -or [int]$commitCount -lt 1) { Fail "还没有提交，请先 git add -A; git commit" }

# 3) 确定 GitHub 用户名
$owner = ""
if ($Token -ne "") {
  try {
    $owner = (Invoke-RestMethod -Headers @{ Authorization = "token $Token"; "User-Agent" = "publish-github" } -Uri "https://api.github.com/user").login
  } catch { Fail "令牌无效或网络不通: $($_.Exception.Message)" }
} elseif (Get-Command gh -ErrorAction SilentlyContinue) {
  try { $owner = (gh api user --jq .login 2>$null) } catch { $owner = "" }
}

if (-not $owner) {
  Write-Host ""
  Write-Host "未检测到 GitHub 登录。任选一种方式：" -ForegroundColor Yellow
  Write-Host "  A) 安装 GitHub CLI 并登录："
  Write-Host "     winget install --id GitHub.cli -e"
  Write-Host "     gh auth login"
  Write-Host "     然后重新运行本脚本"
  Write-Host "  B) 创建个人访问令牌："
  Write-Host "     https://github.com/settings/tokens  （Generate new token → 勾选 repo）"
  Write-Host "     然后：`$env:GH_TOKEN = \"ghp_你的令牌\"; .\publish-github.ps1"
  exit 1
}

# 4) 创建远程仓库并推送
if ((Get-Command gh -ErrorAction SilentlyContinue) -and $Token -eq "") {
  Write-Host "[发布] 使用 gh 创建仓库 $owner/$RepoName ($Visibility) 并推送…"
  gh repo create $RepoName --$Visibility --source $repoRoot --remote origin --push --description $DESCRIPTION
  if ($LASTEXITCODE -ne 0) { Fail "gh repo create 失败（exit $LASTEXITCODE）" }
} else {
  $remoteUrl = "https://x-access-token:$Token@github.com/$owner/$RepoName.git"
  try {
    Invoke-RestMethod -Method Post -Headers @{ Authorization = "token $Token"; "User-Agent" = "publish-github" } `
      -ContentType "application/json" -Uri "https://api.github.com/user/repos" `
      -Body (@{ name = $RepoName; private = ($Visibility -eq "private"); description = $DESCRIPTION } | ConvertTo-Json) | Out-Null
    Write-Host "[发布] 已创建仓库 $owner/$RepoName ($Visibility)"
  } catch {
    Write-Host "[发布] 创建仓库跳过（可能已存在）: $($_.Exception.Message)"
  }
  $origin = & $git -C $repoRoot remote
  if ($origin -match '^origin$') { & $git -C $repoRoot remote set-url origin $remoteUrl }
  else { & $git -C $repoRoot remote add origin $remoteUrl }
  & $git -C $repoRoot push -u origin HEAD:main
  if ($LASTEXITCODE -ne 0) { Fail "git push 失败（exit $LASTEXITCODE）" }
}

Write-Host ""
Write-Host "[发布] 完成：https://github.com/$owner/$RepoName" -ForegroundColor Green
Write-Host "[发布] 后续发版：改代码 → node build-extension.js → git add -A; git commit -m v1.1.0; git push"
