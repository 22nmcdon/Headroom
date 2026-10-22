// Several files, as one.
//
// A scene exported as stems is five or six files - a wav a track, a wav of
// the mix, and the MIDI - and handing those over one at a time means five
// downloads, five permission prompts in some browsers, and five things to
// find in a folder afterwards. One archive is one drag onto a DAW.
//
// Stored, not deflated. Audio at twenty-four bits does not compress: a few
// per cent, for a compressor nobody here has written and would have to
// maintain. What this writes is the oldest and most widely read corner of
// the format - local header, data, central directory, end record - with no
// extensions at all, which is what makes it openable by everything from
// macOS's Archive Utility to a DAW's own importer.

/**
 * CRC-32, as the format wants it.
 *
 * The table is built once on first use rather than written out as 256
 * constants. Reflected polynomial 0xEDB88320, which is the only one this
 * format has ever used.
 */
let TABLE = null;

function table() {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[i] = c >>> 0;
  }
  return TABLE;
}

export function crc32(bytes) {
  const lookup = table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = lookup[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A name, as the bytes that go in the archive. */
const nameBytes = (name) => new TextEncoder().encode(name);

/**
 * A time and date, in the two sixteen-bit fields MS-DOS used in 1980.
 *
 * Seconds have a resolution of two, the year counts from 1980, and the whole
 * thing is in local time with no zone anywhere - which is why an archive
 * made at noon can open showing eleven. Every writer has this; it is the
 * format.
 */
export function dosTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9)
    | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/** The size of each record, which is where an off-by-one becomes unopenable. */
const LOCAL_HEAD = 30;
const CENTRAL_HEAD = 46;
const END_RECORD = 22;

/**
 * Files in, archive out.
 *
 * `files` is `[{ name, bytes }]`. Names use forward slashes, whatever the
 * machine writing them does: the format says so, and an archive with
 * backslashes in it opens as one file with a strange name rather than as a
 * folder.
 */
export function writeZip(files, { date = new Date() } = {}) {
  const { time, day } = dosTime(date);

  const entries = files.map((file) => ({
    name: nameBytes(String(file.name).replace(/\\/g, '/')),
    bytes: file.bytes,
    crc: crc32(file.bytes),
  }));

  const total = entries.reduce(
    (sum, entry) => sum + LOCAL_HEAD + entry.name.length + entry.bytes.length
      + CENTRAL_HEAD + entry.name.length,
    END_RECORD,
  );

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;

  const put = (bytes) => { out.set(bytes, at); at += bytes.length; };
  const u32 = (value) => { view.setUint32(at, value, true); at += 4; };
  const u16 = (value) => { view.setUint16(at, value, true); at += 2; };

  const starts = [];

  for (const entry of entries) {
    starts.push(at);
    u32(LOCAL);
    u16(20);              // the version needed: 2.0, which is stored or deflated
    u16(0);               // no flags - not encrypted, sizes known up front
    u16(0);               // stored
    u16(time);
    u16(day);
    u32(entry.crc);
    u32(entry.bytes.length);
    u32(entry.bytes.length);
    u16(entry.name.length);
    u16(0);               // no extra field
    put(entry.name);
    put(entry.bytes);
  }

  const directory = at;

  entries.forEach((entry, index) => {
    u32(CENTRAL);
    u16(20);              // written by 2.0
    u16(20);              // needs 2.0
    u16(0);
    u16(0);
    u16(time);
    u16(day);
    u32(entry.crc);
    u32(entry.bytes.length);
    u32(entry.bytes.length);
    u16(entry.name.length);
    u16(0);               // extra
    u16(0);               // comment
    u16(0);               // the disk it is on, of which there is one
    u16(0);               // internal attributes
    u32(0);               // external attributes
    u32(starts[index]);
    put(entry.name);
  });

  // Taken before a byte of the end record is written. `at` moves as the
  // record goes down, so computing the directory's size in the middle of
  // writing it reports it twelve bytes too long - which round-trips fine
  // through a reader that uses the count and the offset, and which `unzip`
  // refuses outright as an archive with overlapping components.
  const size = at - directory;

  u32(END);
  u16(0);                 // this disk
  u16(0);                 // the disk the directory starts on
  u16(entries.length);
  u16(entries.length);
  u32(size);
  u32(directory);
  u16(0);                 // no comment

  return out;
}

/**
 * And back, as far as the tests need.
 *
 * Reads the central directory rather than scanning for local headers, which
 * is what every real reader does and the only way to be sure what is in an
 * archive rather than what looks like it might be.
 */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let end = bytes.length - END_RECORD;
  while (end >= 0 && view.getUint32(end, true) !== END) end -= 1;
  if (end < 0) return null;

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);

  const files = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL) return null;

    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const where = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.slice(at + CENTRAL_HEAD, at + CENTRAL_HEAD + nameLength));

    // The data sits after that entry's own local header, whose name and
    // extra lengths are its own and need not match the central one's.
    const localName = view.getUint16(where + 26, true);
    const localExtra = view.getUint16(where + 28, true);
    const from = where + LOCAL_HEAD + localName + localExtra;

    files.push({ name, bytes: bytes.slice(from, from + size), crc });
    at += CENTRAL_HEAD + nameLength + extra + comment;
  }

  return files;
}
