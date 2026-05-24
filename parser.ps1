# Load KML
$kmlPath = "data.kml"
if (-not (Test-Path $kmlPath)) {
    Write-Error "File data.kml not found!"
    exit 1
}

[xml]$kml = Get-Content $kmlPath
$ns = New-Object System.Xml.XmlNamespaceManager($kml.NameTable)
$ns.AddNamespace("k", "http://www.opengis.net/kml/2.2")

$dpPoints = New-Object System.Collections.Generic.List[Object]
$cableSegs = New-Object System.Collections.Generic.List[Object]

# Parse Placemarks
$placemarks = $kml.SelectNodes("//k:Placemark", $ns)
foreach ($pm in $placemarks) {
    # Get Name
    $nameNode = $pm.SelectSingleNode("k:name", $ns)
    $name = if ($nameNode) { $nameNode.InnerText.Trim() } else { "Untitled" }
    
    # Get Description
    $descNode = $pm.SelectSingleNode("k:description", $ns)
    $desc = if ($descNode) { $descNode.InnerText.Trim() } else { "" }
    
    # Check for Point (DP)
    $pointNode = $pm.SelectSingleNode(".//k:Point", $ns)
    if ($pointNode) {
        $coordNode = $pointNode.SelectSingleNode("k:coordinates", $ns)
        if ($coordNode) {
            $coords = $coordNode.InnerText.Trim().Split(',')
            if ($coords.Length -ge 2) {
                $dpPoints.Add(@{
                    id = $dpPoints.Count
                    name = $name
                    desc = $desc
                    lat = [double]$coords[1]
                    lng = [double]$coords[0]
                })
            }
        }
    }

    # Check for LineString (Cable)
    $lineNode = $pm.SelectSingleNode(".//k:LineString", $ns)
    if ($lineNode) {
        $coordNode = $lineNode.SelectSingleNode("k:coordinates", $ns)
        if ($coordNode) {
            $coordsText = $coordNode.InnerText.Trim()
            $coordsList = $coordsText -split '\s+'
            $segment = New-Object System.Collections.Generic.List[Object]
            foreach ($s in $coordsList) {
                if ($s -ne "") {
                    $parts = $s.Split(',')
                    if ($parts.Length -ge 2) {
                        $segment.Add(@{
                            lat = [double]$parts[1]
                            lng = [double]$parts[0]
                        })
                    }
                }
            }
            if ($segment.Count -ge 2) {
                $cableSegs.Add($segment.ToArray())
            }
        }
    }
}

# Generate JS
# Using -Depth 10 to ensure nested arrays are correctly serialized
$jsText = @"
/* Generated Data */
const KML_DP_POINTS = $($dpPoints | ConvertTo-Json -Depth 10 -Compress);
const KML_CABLE_SEGS = $($cableSegs | ConvertTo-Json -Depth 10 -Compress);
"@

[System.IO.File]::WriteAllText("$(Get-Location)\data.js", $jsText, [System.Text.Encoding]::UTF8)
Write-Host "Successfully generated data.js: $($dpPoints.Count) DPs, $($cableSegs.Count) Segments"
