import fs from 'fs';
import path from 'path';
import selfsigned from 'selfsigned';

export function getCerts() {
  const certsDir = path.join(process.cwd(), 'certs');
  console.log('Certificates directory:', certsDir);
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir);
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, { days: 365 });
    fs.writeFileSync(path.join(certsDir, 'cert.pem'), pems.cert);
    fs.writeFileSync(path.join(certsDir, 'key.pem'), pems.private);
    console.log('Self-signed certificates generated in', certsDir);
  }
  return {
    cert: fs.readFileSync(path.join(certsDir, 'cert.pem')),
    key: fs.readFileSync(path.join(certsDir, 'key.pem'))
  };
}
