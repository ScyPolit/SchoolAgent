// Test-only local SMTP peer. It never forwards mail or connects outside loopback.
import { createServer } from 'node:net';

export async function createSmtpCapture() {
  const messages = [], sockets = new Set();
  const control = { rejectRecipients: false, rejectData: false, credentials: null };
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    let pending = '', data = null, envelope = { from: '', to: [] }, authenticated = false;
    const reply = line => socket.write(line + '\r\n');
    reply('220 localhost test-only SMTP capture');
    socket.on('data', chunk => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 2);
        if (data !== null) {
          if (line === '.') {
            if (control.rejectData) reply('554 5.7.1 Test-only delivery rejection');
            else {
              messages.push({ ...envelope, to: [...envelope.to], raw: data.join('\r\n'), authenticated });
              reply('250 2.0.0 Accepted by local test capture');
            }
            data = null; envelope = { from: '', to: [] };
          } else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        const [verb, ...parts] = line.split(' '), argument = parts.join(' ');
        switch (verb.toUpperCase()) {
          case 'EHLO': reply('250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 10485760'); break;
          case 'HELO': reply('250 localhost'); break;
          case 'AUTH': {
            const encoded = argument.match(/^PLAIN\s+(.+)$/i)?.[1];
            const [, username, password] = encoded ? Buffer.from(encoded, 'base64').toString().split('\0') : [];
            authenticated = Boolean(control.credentials && username === control.credentials.username && password === control.credentials.password);
            reply(authenticated ? '235 2.7.0 Authentication successful' : '535 5.7.8 Invalid test credentials');
            break;
          }
          case 'MAIL':
            if (control.credentials && !authenticated) reply('530 5.7.0 Authentication required');
            else { envelope.from = argument.replace(/^FROM:/i, '').trim(); reply('250 2.1.0 Sender accepted'); }
            break;
          case 'RCPT':
            if (control.rejectRecipients) reply('550 5.1.1 Rejected by local test capture');
            else { envelope.to.push(argument.replace(/^TO:/i, '').trim()); reply('250 2.1.5 Recipient accepted'); }
            break;
          case 'DATA': data = []; reply('354 End with <CRLF>.<CRLF>'); break;
          case 'RSET': envelope = { from: '', to: [] }; data = null; reply('250 2.0.0 Reset'); break;
          case 'NOOP': reply('250 2.0.0 OK'); break;
          case 'QUIT': reply('221 2.0.0 Bye'); socket.end(); break;
          default: reply('502 5.5.1 Unsupported test command');
        }
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    host: '127.0.0.1', port: server.address().port, messages, control,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}

export function mailText(raw) {
  const separator = raw.indexOf('\r\n\r\n');
  const headers = raw.slice(0, separator), body = raw.slice(separator + 4);
  if (/content-transfer-encoding:\s*base64/i.test(headers)) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) {
    return Buffer.from(body.replace(/=\r\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'binary').toString('utf8');
  }
  return body;
}
