Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\91969\Desktop\GoodNotes Clone\GoodNotes_App\electron\icon.jpg"
$icoPath = "C:\Users\91969\Desktop\GoodNotes Clone\GoodNotes_App\electron\icon.ico"

$srcImg = [System.Drawing.Image]::FromFile($srcPath)

# ICO file format writer
function Write-Ico {
    param([string]$outPath, [System.Drawing.Image[]]$images)
    
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    
    $count = $images.Count
    # ICO header
    $bw.Write([uint16]0)      # reserved
    $bw.Write([uint16]1)      # type: 1=ICO
    $bw.Write([uint16]$count) # image count
    
    # Image data streams
    $imgStreams = @()
    foreach ($img in $images) {
        $ims = New-Object System.IO.MemoryStream
        $img.Save($ims, [System.Drawing.Imaging.ImageFormat]::Png)
        $imgStreams += $ims
    }
    
    # Directory entries (each 16 bytes)
    $offset = 6 + ($count * 16)
    for ($i = 0; $i -lt $count; $i++) {
        $sz = $images[$i].Width
        $bw.Write([byte]$(if ($sz -ge 256) { 0 } else { $sz }))  # width (0=256)
        $bw.Write([byte]$(if ($sz -ge 256) { 0 } else { $sz }))  # height
        $bw.Write([byte]0)   # color palette
        $bw.Write([byte]0)   # reserved
        $bw.Write([uint16]1) # color planes
        $bw.Write([uint16]32) # bits per pixel
        $bw.Write([uint32]$imgStreams[$i].Length)
        $bw.Write([uint32]$offset)
        $offset += $imgStreams[$i].Length
    }
    
    # Write image data
    foreach ($ims in $imgStreams) {
        $bw.Write($ims.ToArray())
        $ims.Dispose()
    }
    
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($outPath, $ms.ToArray())
    $bw.Dispose()
    $ms.Dispose()
}

$sizes = @(256, 128, 64, 48, 32, 24, 16)
$imgs = @()
foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($srcImg, 0, 0, $s, $s)
    $g.Dispose()
    $imgs += $bmp
}

Write-Ico -outPath $icoPath -images $imgs
foreach ($img in $imgs) { $img.Dispose() }
$srcImg.Dispose()

Write-Host "ICO created at: $icoPath"
