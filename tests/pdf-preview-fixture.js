'use strict';
// Two-page synthetic fixture: text/vector certificate, then a scan-like image.
module.exports=function pdfFixture(){
  const z=require('node:zlib'),pixels=Buffer.from([210,50,40,210,50,40,30,80,190,30,80,190]);
  const stream=b=>Buffer.concat([Buffer.from('<< /Length '+b.length+' >>\nstream\n'),b,Buffer.from('\nendstream')]);
  const objects=[null,
    '<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream(Buffer.from('0.1 0.2 0.4 rg 40 710 515 5 re f\nBT /F1 24 Tf 45 750 Td (SYNTHETIC CERTIFICATE) Tj 0 -65 Td /F1 16 Tf (Page one: worker PDF preview test.) Tj ET')),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 8 0 R >> /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    stream(Buffer.from('q 420 0 0 420 80 220 cm /Im1 Do Q BT /F1 18 Tf 70 740 Td (Page two: scanned-image test.) Tj ET')),
    Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length '+z.deflateSync(pixels).length+' >>\nstream\n'),z.deflateSync(pixels),Buffer.from('\nendstream')])];
  const parts=[Buffer.from('%PDF-1.4\n')],offsets=[0];let size=parts[0].length;
  for(let i=1;i<objects.length;i++){offsets.push(size);const b=Buffer.concat([Buffer.from(i+' 0 obj\n'),Buffer.isBuffer(objects[i])?objects[i]:Buffer.from(objects[i]),Buffer.from('\nendobj\n')]);parts.push(b);size+=b.length;}
  parts.push(Buffer.from('xref\n0 '+objects.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+size+'\n%%EOF\n'));return Buffer.concat(parts);
};
