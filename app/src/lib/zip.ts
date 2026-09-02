/**
 * Een minimale ZIP-schrijver, zonder compressie ("stored").
 *
 * Waarom geen bibliotheek: de enige gebruiker is de site-export, en die pakt
 * een handvol HTML-bestanden plus wat uploads in. Een afhankelijkheid erbij
 * voor honderd regels formaat weegt niet op tegen wat ze meebrengt — zeker
 * niet in een app die als Windows-installer wordt uitgeleverd, waar elke
 * dependency ook in de bundel belandt.
 *
 * Zonder compressie omdat het formaat dan exact het bestand is dat erin gaat:
 * geen deflate-implementatie om fout te doen, en HTML van deze omvang wint er
 * weinig mee. Elke gangbare uitpakker (Windows Verkenner inbegrepen) leest
 * "stored" even goed als "deflated".
 */

const CRC_TABEL = (() => {
  const tabel = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabel[i] = c >>> 0;
  }
  return tabel;
})();

function crc32(data: Uint8Array<ArrayBuffer>): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABEL[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS datum/tijd. Seconden gaan in stappen van twee — dat is het formaat,
 *  niet een afronding van ons. */
function dosDatumTijd(d: Date): { tijd: number; datum: number } {
  return {
    tijd: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    datum: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// Uint8Array<ArrayBuffer> en niet het kale Uint8Array: dat laatste staat ook
// een SharedArrayBuffer toe, en die accepteert Blob niet als BlobPart.
export type ZipInvoer = { naam: string; data: Uint8Array<ArrayBuffer> };

export function maakZip(bestanden: ZipInvoer[], nu: Date = new Date()): Blob {
  const { tijd, datum } = dosDatumTijd(nu);
  const encoder = new TextEncoder();

  const lokaal: Uint8Array<ArrayBuffer>[] = [];
  const centraal: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const bestand of bestanden) {
    const naam = encoder.encode(bestand.naam);
    const crc = crc32(bestand.data);
    const grootte = bestand.data.length;

    const kop = new DataView(new ArrayBuffer(30));
    kop.setUint32(0, 0x04034b50, true); // local file header
    kop.setUint16(4, 20, true); // versie nodig
    kop.setUint16(6, 0x0800, true); // vlag: bestandsnaam is UTF-8
    kop.setUint16(8, 0, true); // methode 0 = stored
    kop.setUint16(10, tijd, true);
    kop.setUint16(12, datum, true);
    kop.setUint32(14, crc, true);
    kop.setUint32(18, grootte, true);
    kop.setUint32(22, grootte, true);
    kop.setUint16(26, naam.length, true);
    kop.setUint16(28, 0, true); // geen extra veld

    lokaal.push(new Uint8Array(kop.buffer), naam, bestand.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // central directory header
    cd.setUint16(4, 20, true); // versie gemaakt door
    cd.setUint16(6, 20, true); // versie nodig
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, tijd, true);
    cd.setUint16(14, datum, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, grootte, true);
    cd.setUint32(24, grootte, true);
    cd.setUint16(28, naam.length, true);
    cd.setUint16(30, 0, true); // extra
    cd.setUint16(32, 0, true); // commentaar
    cd.setUint16(34, 0, true); // schijfnummer
    cd.setUint16(36, 0, true); // interne attributen
    cd.setUint32(38, 0, true); // externe attributen
    cd.setUint32(42, offset, true);

    centraal.push(new Uint8Array(cd.buffer), naam);
    offset += 30 + naam.length + grootte;
  }

  const centraalGrootte = centraal.reduce((n, d) => n + d.length, 0);

  const eind = new DataView(new ArrayBuffer(22));
  eind.setUint32(0, 0x06054b50, true); // end of central directory
  eind.setUint16(4, 0, true);
  eind.setUint16(6, 0, true);
  eind.setUint16(8, bestanden.length, true);
  eind.setUint16(10, bestanden.length, true);
  eind.setUint32(12, centraalGrootte, true);
  eind.setUint32(16, offset, true);
  eind.setUint16(20, 0, true); // geen commentaar

  return new Blob([...lokaal, ...centraal, new Uint8Array(eind.buffer)], {
    type: "application/zip",
  });
}
