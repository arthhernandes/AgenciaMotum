param(
  [Parameter(Mandatory=$true)][string]$Path,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
function Read-XmlEntry([string]$entryPath) {
  $entry=$archive.GetEntry($entryPath)
  if(!$entry -or $entry.Length -gt 100MB){throw "Entrada XLSX ausente ou muito grande: $entryPath"}
  $reader=[System.IO.StreamReader]::new($entry.Open())
  try{$xml=[System.Xml.XmlDocument]::new();$xml.XmlResolver=$null;$xml.LoadXml($reader.ReadToEnd());return $xml}finally{$reader.Dispose()}
}
try {
  $stringsXml=Read-XmlEntry 'xl/sharedStrings.xml'
  $strings=@($stringsXml.sst.si | ForEach-Object {$_.InnerText})
  $sheet=Read-XmlEntry 'xl/worksheets/sheet1.xml'
  $rows=[System.Collections.Generic.List[object]]::new()
  foreach($row in $sheet.worksheet.sheetData.row){
    $cells=@{}
    foreach($cell in $row.c){
      $column=[regex]::Replace($cell.r,'\d','')
      $value=if($cell.t -eq 's'){$strings[[int]$cell.v]}elseif($cell.t -eq 'inlineStr'){$cell.is.InnerText}else{[string]$cell.v}
      $cells[$column]=$value
    }
    $formatted=[string]$cells['A']
    if($formatted -notmatch '^\d[\d.]*$'){continue}
    $code=$formatted.Replace('.','')
    if($code.Length -lt 2 -or $code.Length -gt 8 -or ![string]$cells['B']){throw "Linha NCM inválida: $($row.r)"}
    $rows.Add([ordered]@{code=$code;formattedCode=$formatted;description=[string]$cells['B'];validFrom=[string]$cells['C'];validUntil=[string]$cells['D'];legalAct=[string]$cells['E'];legalNumber=[string]$cells['F'];legalYear=[string]$cells['G']})
  }
  $data=[ordered]@{source=[System.IO.Path]::GetFileName($Path);sourceHash=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower();referenceDate='2026-10-14';entries=$rows.ToArray()}
  $json=ConvertTo-Json -InputObject $data -Depth 6
  [System.IO.File]::WriteAllText($OutputPath,$json,[System.Text.UTF8Encoding]::new($false))
  $rows | Group-Object {$_.code.Length} | ForEach-Object {[pscustomobject]@{Digits=$_.Name;Rows=$_.Count}} | Format-Table
}finally{$archive.Dispose()}
