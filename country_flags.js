// country_flags.js — পৃথিবীর সব দেশ/টেরিটরি: নাম, ফোন কোড, flag।
// number_panel.js এটা ব্যবহার করে: detectCountry(নাম বা নাম্বার/রেঞ্জ) এবং COUNTRY_DATA
// Flag আসে ISO কোড থেকে (ভুল টাইপের ঝুঁকি নেই)। নতুন দেশ যোগ করতে TABLE-এ একটা লাইন বসান।

const flagOf = (iso) =>
  String.fromCodePoint(...[...String(iso).toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

// ISO | নাম | ফোন কোড (কমা দিয়ে একাধিক) | বিকল্প নাম (; দিয়ে)
// নিয়ম: যে কোডটা একাধিক দেশ ভাগ করে, মূল দেশ আগে থাকবে (নিচে "শেয়ার্ড" অংশ দেখুন)
const TABLE = `
US|USA / Canada|1|usa;united states;united states of america;us;america;u s a
RU|Russia|7|russian federation
KZ|Kazakhstan|76,77|
EG|Egypt|20|
ZA|South Africa|27|
GR|Greece|30|
NL|Netherlands|31|holland
BE|Belgium|32|
FR|France|33|
ES|Spain|34|
HU|Hungary|36|
IT|Italy|39|
RO|Romania|40|
CH|Switzerland|41|
AT|Austria|43|
GB|United Kingdom|44|uk;great britain;england;britain;scotland;wales;northern ireland
DK|Denmark|45|
SE|Sweden|46|
NO|Norway|47|
PL|Poland|48|
DE|Germany|49|
PE|Peru|51|
MX|Mexico|52|
CU|Cuba|53|
AR|Argentina|54|
BR|Brazil|55|
CL|Chile|56|
CO|Colombia|57|
VE|Venezuela|58|
MY|Malaysia|60|
AU|Australia|61|
ID|Indonesia|62|
PH|Philippines|63|
NZ|New Zealand|64|
SG|Singapore|65|
TH|Thailand|66|
JP|Japan|81|
KR|South Korea|82|korea;republic of korea;korea south
VN|Vietnam|84|viet nam
CN|China|86|
TR|Turkey|90|turkiye
IN|India|91|
PK|Pakistan|92|
AF|Afghanistan|93|
LK|Sri Lanka|94|
MM|Myanmar|95|burma
IR|Iran|98|
SS|South Sudan|211|
MA|Morocco|212|
DZ|Algeria|213|
TN|Tunisia|216|
LY|Libya|218|
GM|Gambia|220|
SN|Senegal|221|
MR|Mauritania|222|
ML|Mali|223|
GN|Guinea|224|
CI|Côte d'Ivoire|225|ivory coast
BF|Burkina Faso|226|
NE|Niger|227|
TG|Togo|228|
BJ|Benin|229|
MU|Mauritius|230|
LR|Liberia|231|
SL|Sierra Leone|232|
GH|Ghana|233|
NG|Nigeria|234|
TD|Chad|235|
CF|Central African Republic|236|car
CM|Cameroon|237|
CV|Cape Verde|238|cabo verde
ST|São Tomé and Príncipe|239|sao tome;sao tome and principe
GQ|Equatorial Guinea|240|
GA|Gabon|241|
CG|Congo|242|republic of the congo;congo brazzaville
CD|DR Congo|243|democratic republic of the congo;congo kinshasa;drc;congo drc;dr of congo
AO|Angola|244|
GW|Guinea-Bissau|245|guinea bissau
IO|British Indian Ocean Territory|246|diego garcia
AC|Ascension Island|247|ascension
SC|Seychelles|248|
SD|Sudan|249|
RW|Rwanda|250|
ET|Ethiopia|251|
SO|Somalia|252|
DJ|Djibouti|253|
KE|Kenya|254|
TZ|Tanzania|255|
UG|Uganda|256|
BI|Burundi|257|
MZ|Mozambique|258|
ZM|Zambia|260|
MG|Madagascar|261|
RE|Réunion|262|reunion
ZW|Zimbabwe|263|
NA|Namibia|264|
MW|Malawi|265|
LS|Lesotho|266|
BW|Botswana|267|
SZ|Eswatini|268|swaziland
KM|Comoros|269|
SH|Saint Helena|290|st helena
ER|Eritrea|291|
AW|Aruba|297|
FO|Faroe Islands|298|faroe
GL|Greenland|299|
GI|Gibraltar|350|
PT|Portugal|351|
LU|Luxembourg|352|
IE|Ireland|353|
IS|Iceland|354|
AL|Albania|355|
MT|Malta|356|
CY|Cyprus|357|
FI|Finland|358|
BG|Bulgaria|359|
LT|Lithuania|370|
LV|Latvia|371|
EE|Estonia|372|
MD|Moldova|373|
AM|Armenia|374|
BY|Belarus|375|
AD|Andorra|376|
MC|Monaco|377|
SM|San Marino|378|
VA|Vatican City|379|vatican;holy see
UA|Ukraine|380|
RS|Serbia|381|
ME|Montenegro|382|
XK|Kosovo|383|
HR|Croatia|385|
SI|Slovenia|386|
BA|Bosnia and Herzegovina|387|bosnia;bosnia herzegovina
MK|North Macedonia|389|macedonia
CZ|Czech Republic|420|czechia
SK|Slovakia|421|
LI|Liechtenstein|423|
FK|Falkland Islands|500|falklands
BZ|Belize|501|
GT|Guatemala|502|
SV|El Salvador|503|
HN|Honduras|504|
NI|Nicaragua|505|
CR|Costa Rica|506|
PA|Panama|507|
PM|Saint Pierre and Miquelon|508|st pierre and miquelon
HT|Haiti|509|
GP|Guadeloupe|590|
BO|Bolivia|591|
GY|Guyana|592|
EC|Ecuador|593|
GF|French Guiana|594|
PY|Paraguay|595|
MQ|Martinique|596|
SR|Suriname|597|
UY|Uruguay|598|
CW|Curaçao|599|curacao
TL|Timor-Leste|670|east timor;timor leste
AQ|Antarctica|672|
BN|Brunei|673|brunei darussalam
NR|Nauru|674|
PG|Papua New Guinea|675|
TO|Tonga|676|
SB|Solomon Islands|677|
VU|Vanuatu|678|
FJ|Fiji|679|
PW|Palau|680|
WF|Wallis and Futuna|681|
CK|Cook Islands|682|
NU|Niue|683|
WS|Samoa|685|
KI|Kiribati|686|
NC|New Caledonia|687|
TV|Tuvalu|688|
PF|French Polynesia|689|tahiti
TK|Tokelau|690|
FM|Micronesia|691|federated states of micronesia
MH|Marshall Islands|692|
KP|North Korea|850|korea north;dprk
HK|Hong Kong|852|
MO|Macau|853|macao
KH|Cambodia|855|
LA|Laos|856|lao pdr
BD|Bangladesh|880|
TW|Taiwan|886|
MV|Maldives|960|
LB|Lebanon|961|
JO|Jordan|962|
SY|Syria|963|
IQ|Iraq|964|
KW|Kuwait|965|
SA|Saudi Arabia|966|saudi;ksa
YE|Yemen|967|
OM|Oman|968|
PS|Palestine|970|
AE|United Arab Emirates|971|uae;emirates
IL|Israel|972|
BH|Bahrain|973|
QA|Qatar|974|
BT|Bhutan|975|
MN|Mongolia|976|
NP|Nepal|977|
TJ|Tajikistan|992|
TM|Turkmenistan|993|
AZ|Azerbaijan|994|
GE|Georgia|995|
KG|Kyrgyzstan|996|
UZ|Uzbekistan|998|
AI|Anguilla|1264|
AG|Antigua and Barbuda|1268|antigua
BS|Bahamas|1242|the bahamas
BB|Barbados|1246|
BM|Bermuda|1441|
VG|British Virgin Islands|1284|virgin islands british
KY|Cayman Islands|1345|cayman
DM|Dominica|1767|
DO|Dominican Republic|1809,1829,1849|dominican
GD|Grenada|1473|
JM|Jamaica|1876,1658|
MS|Montserrat|1664|
KN|Saint Kitts and Nevis|1869|st kitts and nevis;st kitts
LC|Saint Lucia|1758|st lucia
VC|Saint Vincent and the Grenadines|1784|st vincent;st vincent and the grenadines
TT|Trinidad and Tobago|1868|trinidad
TC|Turks and Caicos Islands|1649|turks and caicos
VI|US Virgin Islands|1340|virgin islands us;united states virgin islands
PR|Puerto Rico|1787,1939|
GU|Guam|1671|
MP|Northern Mariana Islands|1670|
AS|American Samoa|1684|
SX|Sint Maarten|1721|
CA|Canada|1204,1226,1236,1249,1250,1263,1274,1289,1306,1343,1354,1365,1367,1368,1382,1403,1416,1418,1428,1431,1437,1438,1450,1468,1474,1506,1514,1519,1548,1579,1581,1584,1587,1604,1613,1639,1647,1672,1683,1705,1709,1742,1753,1778,1780,1782,1807,1819,1825,1867,1873,1879,1902,1905|
EH|Western Sahara|212|
JE|Jersey|44|
GG|Guernsey|44|
IM|Isle of Man|44|
SJ|Svalbard and Jan Mayen|47|svalbard
CX|Christmas Island|61|
CC|Cocos Islands|61|cocos keeling islands
AX|Åland Islands|358|aland islands;aland
YT|Mayotte|262|
TA|Tristan da Cunha|290|
BL|Saint Barthélemy|590|saint barthelemy;st barthelemy
MF|Saint Martin|590|st martin
BQ|Caribbean Netherlands|599|bonaire;sint eustatius;saba
NF|Norfolk Island|672|
`;

export const COUNTRY_DATA = [];
for (const line of TABLE.split("\n")) {
  const t = line.trim();
  if (!t) continue;
  const [iso, name, codes, alts] = t.split("|");
  const flag = flagOf(iso);
  const alt = (alts || "").split(";").map((s) => s.trim()).filter(Boolean);
  for (const code of codes.split(",")) COUNTRY_DATA.push({ code: code.trim(), flag, name, iso, alt });
}

// ---------- নাম মেলানোর জন্য ----------
const normName = (s) =>
  String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

const NAME_INDEX = new Map(); // নাম/alias → দেশ
for (const c of COUNTRY_DATA) {
  for (const n of [c.name, ...c.alt]) {
    const k = normName(n);
    if (k && !NAME_INDEX.has(k)) NAME_INDEX.set(k, c);
  }
}
// "USA / Canada" লিখলে USA-ই ধরবে, আলাদা করে "usa" ও "canada" দুটোই exact মেলে
const NAMES_BY_LEN = [...NAME_INDEX.keys()].sort((a, b) => b.length - a.length);

const SORTED = [...COUNTRY_DATA].sort((a, b) => b.code.length - a.code.length); // দীর্ঘ কোড আগে (stable)

const hit = (c) => ({ flag: c.flag, name: c.name, code: c.code });

// ========== নাম বা নাম্বার/রেঞ্জ থেকে দেশ চেনা ==========
export function detectCountry(input) {
  if (!input) return { flag: "🌍", name: "Unknown", code: "" };
  const raw = String(input).trim();
  if (!raw) return { flag: "🌍", name: "Unknown", code: "" };

  // 1) নাম: আগে হুবহু মিল, তারপর পুরো-শব্দ হিসেবে সবচেয়ে লম্বা নাম
  //    (যেমন "Romania"-তে "Oman" মেলে না, "Equatorial Guinea"-তে "Guinea"-র আগে পুরোটা মেলে)
  const n = normName(raw);
  if (n && NAME_INDEX.has(n)) return hit(NAME_INDEX.get(n));
  if (n && /[a-z]{3,}/.test(n)) {
    const padded = ` ${n} `;
    for (const k of NAMES_BY_LEN) {
      if (padded.includes(` ${k} `)) return hit(NAME_INDEX.get(k));
    }
  }

  // 2) ডিজিট থেকে ফোন কোড (সবচেয়ে লম্বা prefix আগে — Jamaica 1876, Canada 1416 ইত্যাদি)
  const digits = raw.replace(/\D/g, "");
  if (digits) {
    for (const c of SORTED) if (digits.startsWith(c.code)) return hit(c);
  }

  // 3) "237X6" / "880X01" ধরনের রেঞ্জ
  const beforeX = raw.match(/^\+?(\d+)X/i);
  if (beforeX) {
    for (const c of SORTED) if (beforeX[1].startsWith(c.code)) return hit(c);
  }

  // 4) যেকোনো জায়গায় ৩+ ডিজিট
  const seqs = raw.match(/\d{3,}/g);
  if (seqs) {
    for (const seq of seqs) for (const c of SORTED) if (seq.startsWith(c.code)) return hit(c);
  }

  // 5) চিনতে না পারলে raw নামই দেখাবে
  const fallbackName = raw.replace(/[^\w\s\-]/g, "").trim();
  return { flag: "🌐", name: fallbackName || raw, code: "" };
}

export function formatWithFlag(input, { showName = true } = {}) {
  const i = detectCountry(input);
  return showName ? `${i.flag} ${i.name}` : i.flag;
}
export const getFlag = (input) => detectCountry(input).flag;
export const getCountryName = (input) => detectCountry(input).name;
export const getCountryInfo = (input) => detectCountry(input);
export const parseCountryName = (s) => detectCountry(s);

export default { detectCountry, parseCountryName, getFlag, getCountryName, getCountryInfo, formatWithFlag, COUNTRY_DATA };
