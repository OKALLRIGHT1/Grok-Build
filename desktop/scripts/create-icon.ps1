$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$desktopRoot = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $desktopRoot "build"
$mobileDir = Join-Path $desktopRoot "src\mobile"
$rendererAssets = Join-Path $desktopRoot "src\renderer\assets"
$output = Join-Path $buildDir "icon.png"
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
New-Item -ItemType Directory -Force -Path $mobileDir | Out-Null
New-Item -ItemType Directory -Force -Path $rendererAssets | Out-Null

$size = 512
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

try {
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $radius = 88
    $diameter = $radius * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    try {
        $path.AddArc(8, 8, $diameter, $diameter, 180, 90)
        $path.AddArc($size - $diameter - 8, 8, $diameter, $diameter, 270, 90)
        $path.AddArc($size - $diameter - 8, $size - $diameter - 8, $diameter, $diameter, 0, 90)
        $path.AddArc(8, $size - $diameter - 8, $diameter, $diameter, 90, 90)
        $path.CloseFigure()

        $background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(32, 35, 33))
        try { $graphics.FillPath($background, $path) } finally { $background.Dispose() }
    } finally {
        $path.Dispose()
    }

    $font = New-Object System.Drawing.Font("Segoe UI", 290, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel))
    $foreground = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(248, 251, 248))
    try {
        $format = New-Object System.Drawing.StringFormat
        try {
            $format.Alignment = [System.Drawing.StringAlignment]::Center
            $format.LineAlignment = [System.Drawing.StringAlignment]::Center
            $bounds = New-Object System.Drawing.RectangleF(0, -10, $size, $size)
            $graphics.DrawString("G", $font, $foreground, $bounds, $format)
        } finally {
            $format.Dispose()
        }
    } finally {
        $foreground.Dispose()
        $font.Dispose()
    }

    $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}

Copy-Item -LiteralPath $output -Destination (Join-Path $mobileDir "icon.png") -Force

$wallpaperWidth = 1600
$wallpaperHeight = 1000
$wallpaper = New-Object System.Drawing.Bitmap($wallpaperWidth, $wallpaperHeight)
$wallpaperGraphics = [System.Drawing.Graphics]::FromImage($wallpaper)
$wallpaperGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

try {
    $wallpaperGraphics.Clear([System.Drawing.Color]::FromArgb(214, 224, 220))

    $fields = @(
        @([System.Drawing.Color]::FromArgb(210, 190, 215, 226), @(
            [System.Drawing.PointF]::new(760, -90),
            [System.Drawing.PointF]::new(1600, -90),
            [System.Drawing.PointF]::new(1600, 560),
            [System.Drawing.PointF]::new(1180, 470)
        )),
        @([System.Drawing.Color]::FromArgb(205, 185, 213, 199), @(
            [System.Drawing.PointF]::new(-120, 420),
            [System.Drawing.PointF]::new(610, 300),
            [System.Drawing.PointF]::new(980, 1000),
            [System.Drawing.PointF]::new(-120, 1000)
        )),
        @([System.Drawing.Color]::FromArgb(175, 235, 205, 192), @(
            [System.Drawing.PointF]::new(900, 1000),
            [System.Drawing.PointF]::new(1600, 520),
            [System.Drawing.PointF]::new(1600, 1000)
        )),
        @([System.Drawing.Color]::FromArgb(115, 255, 255, 255), @(
            [System.Drawing.PointF]::new(300, -60),
            [System.Drawing.PointF]::new(940, -60),
            [System.Drawing.PointF]::new(700, 1060),
            [System.Drawing.PointF]::new(40, 1060)
        ))
    )

    foreach ($field in $fields) {
        $brush = New-Object System.Drawing.SolidBrush($field[0])
        try { $wallpaperGraphics.FillPolygon($brush, $field[1]) } finally { $brush.Dispose() }
    }

    $random = New-Object System.Random(42)
    $noiseBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(12, 35, 48, 42))
    try {
        for ($i = 0; $i -lt 18000; $i++) {
            $x = $random.Next(0, $wallpaperWidth)
            $y = $random.Next(0, $wallpaperHeight)
            $wallpaperGraphics.FillRectangle($noiseBrush, $x, $y, 1, 1)
        }
    } finally {
        $noiseBrush.Dispose()
    }

    $wallpaperOutput = Join-Path $rendererAssets "wallpaper.png"
    $wallpaper.Save($wallpaperOutput, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $wallpaperGraphics.Dispose()
    $wallpaper.Dispose()
}

Write-Host "Generated icon: $output"
Write-Host "Generated wallpaper: $wallpaperOutput"
