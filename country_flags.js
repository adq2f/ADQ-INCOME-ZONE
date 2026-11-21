// country_flags.js — দেশের নাম/ফোন-প্রিফিক্স থেকে flag বের করে (number_panel.js এটা ব্যবহার করে)
export const COUNTRY_DATA = [
  // 3-digit codes
  { code: '880', flag: '🇧🇩', name: 'Bangladesh' },
  { code: '977', flag: '🇳🇵', name: 'Nepal' },
  { code: '998', flag: '🇺🇿', name: 'Uzbekistan' },
  { code: '996', flag: '🇰🇬', name: 'Kyrgyzstan' },
  { code: '995', flag: '🇬🇪', name: 'Georgia' },
  { code: '994', flag: '🇦🇿', name: 'Azerbaijan' },
  { code: '993', flag: '🇹🇲', name: 'Turkmenistan' },
  { code: '992', flag: '🇹🇯', name: 'Tajikistan' },
  { code: '964', flag: '🇮🇶', name: 'Iraq' },
  { code: '963', flag: '🇸🇾', name: 'Syria' },
  { code: '962', flag: '🇯🇴', name: 'Jordan' },
  { code: '961', flag: '🇱🇧', name: 'Lebanon' },
  { code: '960', flag: '🇲🇻', name: 'Maldives' },
  { code: '269', flag: '🇰🇲', name: 'Comoros' },
  { code: '268', flag: '🇸🇿', name: 'Eswatini' },
  { code: '267', flag: '🇧🇼', name: 'Botswana' },
  { code: '266', flag: '🇱🇸', name: 'Lesotho' },
  { code: '265', flag: '🇲🇼', name: 'Malawi' },
  { code: '264', flag: '🇳🇦', name: 'Namibia' },
  { code: '263', flag: '🇿🇼', name: 'Zimbabwe' },
  { code: '262', flag: '🇷🇪', name: 'Réunion' },
  { code: '261', flag: '🇲🇬', name: 'Madagascar' },
  { code: '260', flag: '🇿🇲', name: 'Zambia' },
  { code: '258', flag: '🇲🇿', name: 'Mozambique' },
  { code: '257', flag: '🇧🇮', name: 'Burundi' },
  { code: '256', flag: '🇺🇬', name: 'Uganda' },
  { code: '255', flag: '🇹🇿', name: 'Tanzania' },
  { code: '254', flag: '🇰🇪', name: 'Kenya' },
  { code: '253', flag: '🇩🇯', name: 'Djibouti' },
  { code: '252', flag: '🇸🇴', name: 'Somalia' },
  { code: '251', flag: '🇪🇹', name: 'Ethiopia' },
  { code: '250', flag: '🇷🇼', name: 'Rwanda' },
  { code: '249', flag: '🇸🇩', name: 'Sudan' },
  { code: '248', flag: '🇸🇨', name: 'Seychelles' },
  { code: '245', flag: '🇬🇼', name: 'Guinea-Bissau' },
  { code: '244', flag: '🇦🇴', name: 'Angola' },
  { code: '243', flag: '🇨🇩', name: 'DR Congo' },
  { code: '242', flag: '🇨🇬', name: 'Congo' },
  { code: '241', flag: '🇬🇦', name: 'Gabon' },
  { code: '240', flag: '🇬🇶', name: 'Equatorial Guinea' },
  { code: '239', flag: '🇸🇹', name: 'São Tomé' },
  { code: '238', flag: '🇨🇻', name: 'Cape Verde' },
  { code: '237', flag: '🇨🇲', name: 'Cameroon' },
  { code: '236', flag: '🇨🇫', name: 'Central African Republic' },
  { code: '235', flag: '🇹🇩', name: 'Chad' },
  { code: '234', flag: '🇳🇬', name: 'Nigeria' },
  { code: '233', flag: '🇬🇭', name: 'Ghana' },
  { code: '232', flag: '🇸🇱', name: 'Sierra Leone' },
  { code: '231', flag: '🇱🇷', name: 'Liberia' },
  { code: '230', flag: '🇲🇺', name: 'Mauritius' },
  { code: '229', flag: '🇧🇯', name: 'Benin' },
  { code: '228', flag: '🇹🇬', name: 'Togo' },
  { code: '227', flag: '🇳🇪', name: 'Niger' },
  { code: '226', flag: '🇧🇫', name: 'Burkina Faso' },
  { code: '225', flag: '🇨🇮', name: "Côte d'Ivoire" },
  { code: '224', flag: '🇬🇳', name: 'Guinea' },
  { code: '223', flag: '🇲🇱', name: 'Mali' },
  { code: '222', flag: '🇲🇷', name: 'Mauritania' },
  { code: '221', flag: '🇸🇳', name: 'Senegal' },
  { code: '220', flag: '🇬🇲', name: 'Gambia' },
  { code: '218', flag: '🇱🇾', name: 'Libya' },
  { code: '216', flag: '🇹🇳', name: 'Tunisia' },
  { code: '213', flag: '🇩🇿', name: 'Algeria' },
  { code: '212', flag: '🇲🇦', name: 'Morocco' },

  // 2-digit codes
  { code: '20', flag: '🇪🇬', name: 'Egypt' },
  { code: '27', flag: '🇿🇦', name: 'South Africa' },
  { code: '30', flag: '🇬🇷', name: 'Greece' },
  { code: '31', flag: '🇳🇱', name: 'Netherlands' },
  { code: '32', flag: '🇧🇪', name: 'Belgium' },
  { code: '33', flag: '🇫🇷', name: 'France' },
  { code: '34', flag: '🇪🇸', name: 'Spain' },
  { code: '36', flag: '🇭🇺', name: 'Hungary' },
  { code: '39', flag: '🇮🇹', name: 'Italy' },
  { code: '40', flag: '🇷🇴', name: 'Romania' },
  { code: '41', flag: '🇨🇭', name: 'Switzerland' },
  { code: '43', flag: '🇦🇹', name: 'Austria' },
  { code: '44', flag: '🇬🇧', name: 'United Kingdom' },
  { code: '45', flag: '🇩🇰', name: 'Denmark' },
  { code: '46', flag: '🇸🇪', name: 'Sweden' },
  { code: '47', flag: '🇳🇴', name: 'Norway' },
  { code: '48', flag: '🇵🇱', name: 'Poland' },
  { code: '49', flag: '🇩🇪', name: 'Germany' },
  { code: '51', flag: '🇵🇪', name: 'Peru' },
  { code: '52', flag: '🇲🇽', name: 'Mexico' },
  { code: '53', flag: '🇨🇺', name: 'Cuba' },
  { code: '54', flag: '🇦🇷', name: 'Argentina' },
  { code: '55', flag: '🇧🇷', name: 'Brazil' },
  { code: '56', flag: '🇨🇱', name: 'Chile' },
  { code: '57', flag: '🇨🇴', name: 'Colombia' },
  { code: '58', flag: '🇻🇪', name: 'Venezuela' },
  { code: '60', flag: '🇲🇾', name: 'Malaysia' },
  { code: '61', flag: '🇦🇺', name: 'Australia' },
  { code: '62', flag: '🇮🇩', name: 'Indonesia' },
  { code: '63', flag: '🇵🇭', name: 'Philippines' },
  { code: '64', flag: '🇳🇿', name: 'New Zealand' },
  { code: '65', flag: '🇸🇬', name: 'Singapore' },
  { code: '66', flag: '🇹🇭', name: 'Thailand' },
  { code: '81', flag: '🇯🇵', name: 'Japan' },
  { code: '82', flag: '🇰🇷', name: 'South Korea' },
  { code: '84', flag: '🇻🇳', name: 'Vietnam' },
  { code: '86', flag: '🇨🇳', name: 'China' },
  { code: '90', flag: '🇹🇷', name: 'Turkey' },
  { code: '91', flag: '🇮🇳', name: 'India' },
  { code: '92', flag: '🇵🇰', name: 'Pakistan' },
  { code: '93', flag: '🇦🇫', name: 'Afghanistan' },
  { code: '94', flag: '🇱🇰', name: 'Sri Lanka' },
  { code: '95', flag: '🇲🇲', name: 'Myanmar' },
  { code: '98', flag: '🇮🇷', name: 'Iran' },

  // 1-digit codes
  { code: '1', flag: '🇺🇸', name: 'USA / Canada' },
  { code: '7', flag: '🇷🇺', name: 'Russia / Kazakhstan' }
];

const SORTED = [...COUNTRY_DATA].sort((a, b) => b.code.length - a.code.length);

// নাম বা নাম্বার/রেঞ্জ থেকে দেশ চেনে
export function detectCountry(input) {
  if (!input) return { flag: '🌍', name: 'Unknown', code: '' };
  const raw = String(input).trim();
  if (!raw) return { flag: '🌍', name: 'Unknown', code: '' };

  const lower = raw.toLowerCase();
  for (const c of COUNTRY_DATA) {
    if (lower.includes(c.name.toLowerCase())) return { flag: c.flag, name: c.name, code: c.code };
  }

  const digits = raw.replace(/\D/g, '');
  if (digits) {
    for (const c of SORTED) {
      if (digits.startsWith(c.code)) return { flag: c.flag, name: c.name, code: c.code };
    }
  }

  const beforeX = raw.match(/^(\d+)X/i);
  if (beforeX) {
    for (const c of SORTED) {
      if (beforeX[1].startsWith(c.code)) return { flag: c.flag, name: c.name, code: c.code };
    }
  }

  const seqs = raw.match(/\d{3,}/g);
  if (seqs) {
    for (const seq of seqs) {
      for (const c of SORTED) {
        if (seq.startsWith(c.code)) return { flag: c.flag, name: c.name, code: c.code };
      }
    }
  }

  const fallbackName = raw.replace(/[^\w\s\-]/g, '').trim();
  return { flag: '🌐', name: fallbackName || raw, code: '' };
}

export default { detectCountry, COUNTRY_DATA };
