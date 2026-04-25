/**
 * LoRaWAN DevAddr → NetID parsing.
 *
 * DevAddr is a 32-bit value with a type prefix encoded as leading 1-bits.
 * The prefix determines how many bits are allocated to NwkID vs NwkAddr.
 * NetID is a 24-bit value constructed from the type and NwkID.
 *
 * Reference: LoRaWAN specification, bit_looker (github.com/michaeldjeffrey/bit_looker)
 */

// NwkID bit widths per type (Type 0-7)
const NWK_ID_BITS = [6, 6, 9, 11, 12, 13, 15, 17];

/**
 * Parse a DevAddr hex string into its NetID (hex) and type.
 * @param {string} devAddr - 8-character hex string (e.g. "480002C7")
 * @returns {{ netId: string, type: number } | null}
 */
export function devAddrToNetId(devAddr) {
  if (!devAddr || devAddr.length !== 8) return null;

  const num = parseInt(devAddr, 16) >>> 0; // unsigned 32-bit

  // Count leading 1-bits to determine type
  let type = 0;
  for (let i = 31; i >= 0; i--) {
    if ((num >>> i) & 1) type++;
    else break;
  }
  if (type > 7) return null;

  // Extract NwkID: starts after the prefix (type + 1 bits), length from table
  const nwkIdBits = NWK_ID_BITS[type];
  const nwkIdShift = 32 - (type + 1) - nwkIdBits;
  const nwkIdMask = (1 << nwkIdBits) - 1;
  const nwkId = (num >>> nwkIdShift) & nwkIdMask;

  // NetID is 24 bits: type in bits 23-21, NwkID in remaining bits
  const netId = ((type & 0x07) << 21) | nwkId;

  return {
    netId: netId.toString(16).toUpperCase().padStart(6, "0"),
    type,
  };
}

/**
 * Known NetID → operator name mappings.
 * Source: LoRa Alliance NetID Allocations spreadsheet (186 entries).
 * For interactive lookup: https://michaeldjeffrey.github.io/bit_looker/
 */
/* eslint-disable sort-keys */
const KNOWN_NET_IDS = {
  // Type 0
  "000002": "Actility",
  "000003": "Proximus",
  "000004": "Swisscom",
  "000006": "Echostar Mobile",
  "000007": "Bouygues Telecom",
  "000008": "Orbiwise",
  "000009": "Netmore",
  "00000A": "KPN",
  "00000B": "EveryNet",
  "00000D": "SK Telecom",
  "00000E": "SagemCom",
  "00000F": "Orange",
  "000010": "A2A Smart City",
  "000012": "Kerlink",
  "000013": "The Things Network",
  "000014": "Verizon",
  "000017": "MultiTech",
  "000018": "Loriot",
  "000019": "NNNCo",
  "000022": "Comcast",
  "000023": "Ventia",
  "000024": "Helium (Old)",
  "000030": "SoftBank",
  "000035": "Tencent",
  "000036": "Netze BW",
  "000037": "Tektelic",
  "000038": "Charter",
  "000039": "Amazon",
  "00003A": "Minol ZENNER",
  "00003B": "Semtech",
  "00003C": "Helium",
  "00003E": "Unidata",
  "00003F": "Birdz",
  // Type 3
  "600001": "Digita",
  "600002": "Netmore",
  "600003": "QuaeNet",
  "600005": "IoT Network AS",
  "600008": "Unidata",
  "60000A": "Öresundskraft",
  "60000E": "Spark",
  "600010": "Senet",
  "600013": "Actility",
  "600014": "Kerlink",
  "600017": "Schneider Electric",
  "600018": "Minol ZENNER",
  "60001B": "Tencent",
  "60001C": "MachineQ/Comcast",
  "60001D": "NTT",
  "60001F": "KPN",
  "600020": "Spectrum",
  "600021": "Microshare",
  "600024": "Netze BW",
  "600025": "Tektelic",
  "600027": "Birdz",
  "600028": "Charter",
  "60002A": "Neptune Technology",
  "60002B": "Amazon",
  "60002D": "Helium (DWF)",
  "60002F": "Meshify",
  "600030": "EchoStar Mobile",
  "600032": "Orange",
  "600034": "Semtech",
  "600035": "Wyld Networks",
  "600036": "Unabiz",
  "600038": "Netz NÖ",
  "600039": "Plan-S",
  "60003A": "Verizon",
  "60003B": "Wien Energie",
  // Type 6
  "C00002": "ResIOT",
  "C00003": "SYSDEV",
  "C00008": "Definium",
  "C0000B": "3S",
  "C0000D": "Packetworx",
  "C00012": "Netmore",
  "C00013": "Lyse AS",
  "C00014": "VTC Digicom",
  "C00016": "Schneider Electric",
  "C00017": "Connexin",
  "C00018": "Minol ZENNER",
  "C00019": "Telekom Srbija",
  "C0001A": "REQUEA",
  "C0001B": "Sensor Network Services",
  "C0001D": "Boston Networks",
  "C0001F": "Angel4Future",
  "C00021": "Hiber",
  "C00024": "NTT",
  "C00026": "Mirakonta",
  "C00028": "Lacuna Space",
  "C00029": "Andorra Telecom",
  "C0002A": "Milesight",
  "C0002B": "Grenoble Alps University",
  "C0002E": "Spectrum",
  "C0002F": "Afnic",
  "C00032": "Microshare",
  "C00033": "HEIG-VD",
  "C00037": "Alperia Fiber",
  "C00038": "First Snow",
  "C0003A": "Vutility",
  "C0003B": "Meshed",
  "C0003C": "Birdz",
  "C0003D": "Arthur D Riley",
  "C00040": "Ceske Radiokomunikace",
  "C00042": "Melita.io",
  "C00043": "PROESYS",
  "C00044": "MeWe",
  "C00045": "Alpha-Omega Technology",
  "C00046": "Mayflower Smart Control",
  "C00047": "VEGA Grieshaber",
  "C00049": "Actility",
  "C0004B": "Nova Track",
  "C0004D": "Machines Talk",
  "C0004F": "The IoT Solutions",
  "C00050": "Neptune Technology",
  "C00051": "myDevices",
  "C00052": "Savoie Mont Blanc University",
  "C00053": "Helium (DWF)",
  "C00054": "X-Telia",
  "C00057": "Dingtek",
  "C00058": "The Things Network",
  "C0005A": "Drei Austria",
  "C0005B": "Agrology",
  "C0005C": "mhascaro",
  "C0005D": "Log5 Data",
  "C0005E": "Citysens",
  "C0005F": "Wyld Networks",
  "C00060": "Meshify",
  "C00061": "EchoStar Mobile",
  "C00063": "Hello Space Systems",
  "C00064": "Wien Energie",
  "C00066": "ThingsIX",
  "C00068": "ELSYS",
  "C00069": "UPLINK Network",
  "C0006A": "Nynet",
  "C0006B": "ETA2U",
  "C0006C": "TH Würzburg-Schweinfurt",
  "C0006D": "MClimate",
  "C0006E": "Cibicom",
  "C0006F": "Archipelagos Labs",
  "C00070": "Akenza",
  "C00071": "Ticae Telecom",
  "C00072": "Unabiz",
  "C00073": "SLY Inc.",
  "C00074": "Swisscom",
  "C00075": "Nell Inc",
  "C00076": "Omantel",
  "C00078": "Drop Wireless",
  "C00079": "Plan-S",
  "C0007A": "Emergent Technologies",
  "C0007B": "Sunricher",
  "C0007C": "Netz NÖ",
  "C0007D": "Connected Conservation",
  "C0007E": "Universidad de Salamanca",
  "C0007F": "Heliotics",
  "C00080": "Nesos Group",
  // Type 7
  "E00020": "Techtenna",
  "E00030": "LNX Solutions",
  "E00040": "Cometa",
  "E00050": "Pollex/Zeeland",
  "E00060": "Intersaar",
  "E00080": "HeNet",
  "E00090": "SkyNet IoT",
  "E000A0": "Kanton Zug",
  "E000B0": "Nebra",
  "E000D0": "Borough Smart",
  "E000E0": "ISILINE",
  "E000F0": "Schippers Europe",
  "E00100": "Meshed",
  "E00110": "RemEX Technologies",
  "E00120": "Actility",
  "E00130": "Pollex/Zeeland",
  "E00140": "Tracpac",
  "E00150": "Tracpac",
  "E00160": "VTM IoT",
  "E00170": "Autoskope",
  "E001A0": "Sparknet Technologies",
  "E001B0": "Actility",
  "E001C0": "Actility",
  "E001D0": "SURF",
  "E001E0": "Monsternett",
  "E001F0": "Actility",
  "E00200": "Niederrhein Energie",
  "E00210": "FrostSmart",
  "E00220": "Invisible Systems",
  "E00240": "Actility",
  "E00250": "Actility",
  "E00260": "Actility",
  "E00270": "Actility",
};
/* eslint-enable sort-keys */

/**
 * Look up the operator name for a NetID hex string.
 * @param {string} netIdHex - 6-character hex string (e.g. "00003C")
 * @returns {string | null}
 */
export function netIdToOperator(netIdHex) {
  if (!netIdHex) return null;
  return KNOWN_NET_IDS[netIdHex.toUpperCase()] || null;
}
