# Сборка видео истории ORTA из отрисованных кадров.
#
#   cd C:\taxi\docs\design\story
#   pwsh -File encode.ps1
#
# Вход:  frames\fNNNN.png  (отрисованы render.mjs)
#        audio\orta-story.wav (сделан make-audio.mjs; если файла нет — видео без звука)
# Выход: docs\media\orta-story-9x16.mp4  — вертикаль 1080x1920 для сторис
#        docs\media\orta-story-9x16.webm — тот же ролик в VP9/Opus
#        docs\media\orta-story-1x1.mp4  — квадрат 1080x1080 для ленты
#
# Требуется ffmpeg. Путь берётся из PATH, иначе из C:\ffmpeg\bin\ffmpeg.exe.

param(
  [string]$Frames = "$PSScriptRoot\frames",
  [string]$Audio  = "$PSScriptRoot\audio\orta-story.wav",
  [string]$OutDir = (Resolve-Path "$PSScriptRoot\..\..\media" -ErrorAction SilentlyContinue),
  [int]$Fps = 30
)

$ErrorActionPreference = 'Stop'

$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  $fallback = 'C:\ffmpeg\bin\ffmpeg.exe'
  if (Test-Path $fallback) { $ffmpeg = $fallback } else { throw "ffmpeg не найден: положите его в PATH или в $fallback" }
}

if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot '..\..\media' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$OutDir = (Resolve-Path $OutDir).Path

if (-not (Test-Path $Frames)) { throw "нет кадров: $Frames (сначала запустите render.mjs)" }
$count = (Get-ChildItem $Frames -Filter '*.png').Count
if ($count -eq 0) { throw "в $Frames нет PNG" }
Write-Host "[encode] кадров: $count, fps $Fps"

$hasAudio = Test-Path $Audio
if ($hasAudio) { Write-Host "[encode] звук: $Audio" } else { Write-Host "[encode] звука нет — собираю без дорожки" }

$common = @('-y', '-hide_banner', '-loglevel', 'warning', '-framerate', $Fps, '-i', (Join-Path $Frames 'f%04d.png'))
$audioIn = if ($hasAudio) { @('-i', $Audio) } else { @() }
$map = if ($hasAudio) { @('-map', '0:v:0', '-map', '1:a:0') } else { @() }
$acodec = if ($hasAudio) { @('-c:a', 'aac', '-b:a', '160k') } else { @('-an') }

function Invoke-Encode {
  param([string[]]$Args, [string]$What)
  Write-Host "[encode] $What"
  & $ffmpeg @Args
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg вернул код $LASTEXITCODE на шаге: $What" }
}

# Вертикаль 1080x1920: основной формат для сторис.
Invoke-Encode (@($common, '-i', $Audio) + @(
  '-vf', 'format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-level', '4.2',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '160k', '-shortest',
  (Join-Path $OutDir 'orta-story-9x16.mp4')
)) 'вертикаль H.264 (9:16)'

# Тот же ролик в VP9/Opus — для веба и где H.264 нежелателен.
Invoke-Encode (@($common, '-i', $Audio) + @(
  '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'libopus', '-b:a', '128k', '-shortest',
  (Join-Path $OutDir 'orta-story-9x16.webm')
)) 'вертикаль VP9 (9:16)'

# Квадрат для ленты: кадрируем центр вертикали, где стоят рамки экранов.
Invoke-Encode (@($common, '-i', $Audio) + @(
  '-vf', 'crop=1080:1080:0:390,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '160k', '-shortest',
  (Join-Path $OutDir 'orta-story-1x1.mp4')
)) 'квадрат H.264 (1:1)'

Write-Host ''
Write-Host '[encode] готово:'
Get-ChildItem $OutDir -File | ForEach-Object {
  '{0,-26} {1,8:N1} МБ' -f $_.Name, ($_.Length / 1MB)
}
