$ErrorActionPreference = "Stop"

$docPath = "\\wsl.localhost\Ubuntu-22.04\home\hjp\Workspace\Tempshop\VSCode\hjp.edu.cs.stu.dg\bachelor\2026-zouyuanyuan-codegen\paper\基于交互式需求澄清的智能代码生成系统设计与实现.doc"
$outDir = "\\wsl.localhost\Ubuntu-22.04\home\hjp\Workspace\Tempshop\VSCode\hjp.edu.cs.stu.dg\bachelor\2026-zouyuanyuan-codegen\review_output"
$docxPath = Join-Path $outDir "thesis_converted.docx"

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
    $doc = $word.Documents.Open($docPath, $false, $true, $false)
    $doc.SaveAs2($docxPath, 16)
    $doc.Close($false)
}
finally {
    $word.Quit()
}

Write-Output "DOCX=$docxPath"
