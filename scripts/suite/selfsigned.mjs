/**
 * A self-signed certificate authority, made in JavaScript, for checks that need
 * something to paste.
 *
 * Hand-written DER rather than a library or a tool. The container the browser
 * checks run in has neither `keytool` nor `openssl` — it is a node image and
 * nothing else — and adding a certificate library to this product's
 * dependencies to make one throwaway certificate in one check is a poor trade.
 * Node's own crypto makes the key and the signature; what is written out here
 * is the structure around them, which is a fixed shape.
 *
 * Made for the run rather than checked in, because a checked-in certificate
 * expires and the check then fails for a reason that has nothing to do with the
 * code it is about.
 *
 * Deliberately minimal: version 3, one common name, `basicConstraints CA:TRUE`,
 * and a validity that starts a minute ago. Nothing here is trying to be a
 * general certificate builder, and it should not become one.
 */
import { createSign, generateKeyPairSync } from 'node:crypto';

/** A DER value: one tag byte, a length, and the contents. */
function tlv(tag, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (bytes.length < 0x80) return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);

  // Long form: how many length bytes follow, then the length, big-endian.
  const length = [];
  for (let left = bytes.length; left > 0; left = Math.floor(left / 256)) length.unshift(left % 256);
  return Buffer.concat([Buffer.from([tag, 0x80 | length.length, ...length]), bytes]);
}

const sequence = (...parts) => tlv(0x30, Buffer.concat(parts));
const set = (...parts) => tlv(0x31, Buffer.concat(parts));
const oid = (bytes) => tlv(0x06, Buffer.from(bytes));
const utf8 = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));
const boolean = (value) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const octets = (body) => tlv(0x04, body);
const nul = () => tlv(0x05, Buffer.alloc(0));

/** An INTEGER, kept positive: a leading bit of 1 would read as negative. */
function integer(bytes) {
  const body = Buffer.from(bytes);
  return tlv(0x02, body[0] & 0x80 ? Buffer.concat([Buffer.from([0]), body]) : body);
}

/** A BIT STRING with no unused bits, which is what a signature is. */
const bits = (body) => tlv(0x03, Buffer.concat([Buffer.from([0]), body]));

/** `YYMMDDHHMMSSZ`, which is what a UTCTime is until 2050. */
function utcTime(at) {
  const two = (value) => String(value).padStart(2, '0');
  const text =
    two(at.getUTCFullYear() % 100) +
    two(at.getUTCMonth() + 1) +
    two(at.getUTCDate()) +
    two(at.getUTCHours()) +
    two(at.getUTCMinutes()) +
    two(at.getUTCSeconds()) +
    'Z';
  return tlv(0x17, Buffer.from(text, 'ascii'));
}

/** sha256WithRSAEncryption: 1.2.840.113549.1.1.11 */
const SHA256_WITH_RSA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b];
/** commonName: 2.5.4.3 */
const COMMON_NAME = [0x55, 0x04, 0x03];
/** basicConstraints: 2.5.29.19 */
const BASIC_CONSTRAINTS = [0x55, 0x1d, 0x13];

/**
 * One self-signed certificate, PEM.
 *
 * @param commonName what it calls itself, which is what the subject reads as.
 * @param days how long it is good for. A negative number makes one that has
 *   already expired, which is a state worth being able to check.
 */
export function selfSignedPem(commonName, days = 2) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  const name = sequence(set(sequence(oid(COMMON_NAME), utf8(commonName))));
  const algorithm = sequence(oid(SHA256_WITH_RSA), nul());

  const from = new Date(Date.now() - 60_000);
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const extensions = tlv(
    0xa3,
    sequence(sequence(oid(BASIC_CONSTRAINTS), boolean(true), octets(sequence(boolean(true))))),
  );

  const tbs = sequence(
    tlv(0xa0, integer([0x02])), // version 3, which is zero-based
    integer([0x01, 0x00, 0x00, 0x01]),
    algorithm,
    name,
    sequence(utcTime(from), utcTime(until)),
    name,
    spki,
    extensions,
  );

  const signature = createSign('sha256').update(tbs).sign(privateKey);
  const certificate = sequence(tbs, algorithm, bits(signature));

  const body = certificate.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd();
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}
