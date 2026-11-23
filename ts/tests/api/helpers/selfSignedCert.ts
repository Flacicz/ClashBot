import crypto from 'node:crypto';

export interface SelfSignedCert {
    readonly key: string;
    readonly cert: string;
}

function encodeLength(length: number): Buffer {
    if (length < 0x80) {
        return Buffer.from([length]);
    }
    const bytes: number[] = [];
    let remaining = length;
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff);
        remaining >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, content: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

function derSequence(items: readonly Buffer[]): Buffer {
    return derTag(0x30, Buffer.concat(items));
}

function derSet(items: readonly Buffer[]): Buffer {
    return derTag(0x31, Buffer.concat(items));
}

function derInteger(bytes: Buffer): Buffer {
    const needsPadding = bytes.length > 0 && (bytes[0] ?? 0) >= 0x80;
    const content = needsPadding ? Buffer.concat([Buffer.from([0x00]), bytes]) : bytes;
    return derTag(0x02, content);
}

function derBitString(bytes: Buffer): Buffer {
    return derTag(0x03, Buffer.concat([Buffer.from([0x00]), bytes]));
}

function derOctetString(bytes: Buffer): Buffer {
    return derTag(0x04, bytes);
}

function derNull(): Buffer {
    return Buffer.from([0x05, 0x00]);
}

function derOid(oid: string): Buffer {
    const parts = oid.split('.').map((part) => Number(part));
    const first = (parts[0] ?? 0) * 40 + (parts[1] ?? 0);
    const out: number[] = [first];
    for (let i = 2; i < parts.length; i += 1) {
        let value = parts[i] ?? 0;
        const encoded: number[] = [value & 0x7f];
        value >>= 7;
        while (value > 0) {
            encoded.unshift((value & 0x7f) | 0x80);
            value >>= 7;
        }
        out.push(...encoded);
    }
    return derTag(0x06, Buffer.from(out));
}

function derUtf8String(value: string): Buffer {
    return derTag(0x0c, Buffer.from(value, 'utf8'));
}

function derUtcTime(date: Date): Buffer {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const year = pad(date.getUTCFullYear() % 100);
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    const seconds = pad(date.getUTCSeconds());
    return derTag(0x17, Buffer.from(`${year}${month}${day}${hours}${minutes}${seconds}Z`, 'ascii'));
}

function derExplicit(tagNumber: number, content: Buffer): Buffer {
    return derTag(0xa0 | tagNumber, content);
}

function toPem(label: string, der: Buffer): string {
    const base64 = der.toString('base64');
    const lines = base64.match(/.{1,64}/g) ?? [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

export function createSelfSignedLoopbackCert(): SelfSignedCert {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
    const sha256WithRsaOid = derSequence([derOid('1.2.840.113549.1.1.11'), derNull()]);
    const commonName = derSequence([
        derSet([derSequence([derOid('2.5.4.3'), derUtf8String('localhost')])]),
    ]);

    const now = Date.now();
    const notBefore = new Date(now - 24 * 60 * 60 * 1000);
    const notAfter = new Date(now + 365 * 24 * 60 * 60 * 1000);
    const validity = derSequence([derUtcTime(notBefore), derUtcTime(notAfter)]);

    const serialBytes = crypto.randomBytes(16);
    serialBytes[0] = (serialBytes[0] ?? 0) & 0x7f;
    if (serialBytes[0] === 0) {
        serialBytes[0] = 1;
    }

    const sanValue = derSequence([
        derTag(0x82, Buffer.from('localhost', 'ascii')),
        derTag(0x87, Buffer.from([127, 0, 0, 1])),
    ]);
    const sanExtension = derSequence([derOid('2.5.29.17'), derOctetString(sanValue)]);
    const extensions = derExplicit(3, derSequence([sanExtension]));

    const tbsCertificate = derSequence([
        derExplicit(0, derInteger(Buffer.from([2]))), // X.509 v3
        derInteger(serialBytes),
        sha256WithRsaOid,
        commonName,
        validity,
        commonName,
        spkiDer,
        extensions,
    ]);

    const signature = crypto.sign('sha256', tbsCertificate, privateKey);
    const certificateDer = derSequence([tbsCertificate, sha256WithRsaOid, derBitString(signature)]);

    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const certPem = toPem('CERTIFICATE', certificateDer);

    return { key: keyPem, cert: certPem };
}
