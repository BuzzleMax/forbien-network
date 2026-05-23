/**
 * Ultra-lightweight compression/decompression utility for SOS messages
 * Optimized for BLE transmission with minimal overhead
 */

// Common SOS message patterns and their abbreviations
const SOS_DICTIONARY = {
  // Emergency types
  'medical': 'MED',
  'fire': 'FIR',
  'security': 'SEC',
  'natural_disaster': 'NAT',
  'accident': 'ACC',
  'hostage': 'HOS',
  'explosion': 'EXP',
  'chemical': 'CHM',
  'radiation': 'RAD',
  'structural': 'STR',
  
  // Status indicators
  'critical': 'CRT',
  'urgent': 'URG',
  'stable': 'STB',
  'unknown': 'UNK',
  'resolved': 'RSV',
  'ongoing': 'ONG',
  'contained': 'CON',
  
  // Locations
  'building': 'BLD',
  'floor': 'FLR',
  'room': 'RM',
  'sector': 'SEC',
  'zone': 'ZON',
  'area': 'ARE',
  'position': 'POS',
  'coordinates': 'COR',
  'latitude': 'LAT',
  'longitude': 'LON',
  'altitude': 'ALT',
  
  // Units and teams
  'unit': 'UNT',
  'team': 'TEM',
  'squad': 'SQD',
  'platoon': 'PLT',
  'company': 'CMP',
  'battalion': 'BTN',
  'headquarters': 'HQ',
  'command': 'CMD',
  'support': 'SUP',
  'medical': 'MED',
  'engineering': 'ENG',
  
  // Actions
  'assist': 'AST',
  'evacuate': 'EVC',
  'secure': 'SCR',
  'contain': 'CNT',
  'investigate': 'INV',
  'report': 'RPT',
  'request': 'REQ',
  'confirm': 'CNF',
  'deny': 'DNY',
  'approve': 'APR',
  
  // Common phrases
  'immediate': 'IMM',
  'assistance': 'ASST',
  'required': 'REQD',
  'available': 'AVL',
  'unavailable': 'UNAV',
  'proceeding': 'PRC',
  'arrived': 'ARR',
  'departed': 'DEP',
  'injured': 'INJ',
  'casualties': 'CAS',
  'fatalities': 'FAT',
  'survivors': 'SRV',
  'missing': 'MSG',
  'trapped': 'TRP',
  'safe': 'SAF',
  'danger': 'DGR',
  'threat': 'THR',
  'risk': 'RSK',
  'hazard': 'HZD',
  'obstacle': 'OBS',
  'blocked': 'BLK',
  'clear': 'CLR',
  'access': 'ACS',
  'exit': 'EXT',
  'entry': 'ENT',
  'perimeter': 'PRM',
  'boundary': 'BND',
  'checkpoint': 'CHK',
  'rally_point': 'RLY',
  'staging_area': 'STG',
  'triage': 'TRI',
  'decontamination': 'DCN',
  'quarantine': 'QRT',
  'lockdown': 'LKD',
  'shelter': 'SHL',
  'evacuation': 'EVC',
  'emergency': 'EMG',
  'priority': 'PRI',
  'alert': 'ALT',
  'warning': 'WRN',
  'caution': 'CAU',
  'notice': 'NTC',
  
  // Numbers and quantities
  'one': '1',
  'two': '2',
  'three': '3',
  'four': '4',
  'five': '5',
  'six': '6',
  'seven': '7',
  'eight': '8',
  'nine': '9',
  'ten': '10',
  'zero': '0',
  'multiple': 'MUL',
  'several': 'SEV',
  'numerous': 'NUM',
  'few': 'FEW',
  'many': 'MNY',
  'all': 'ALL',
  'none': 'NON',
  'some': 'SOM',
  'approximately': 'APX',
  'exactly': 'EXA',
  'over': 'OVR',
  'under': 'UND',
  'between': 'BTW',
  'around': 'ARD',
  'near': 'NAR',
  'far': 'FAR',
  'close': 'CLS',
  'distance': 'DST',
  'range': 'RNG',
  'radius': 'RAD',
  'diameter': 'DIA',
  'perimeter': 'PRM',
  
  // Time
  'seconds': 'SEC',
  'minutes': 'MIN',
  'hours': 'HRS',
  'days': 'DYS',
  'weeks': 'WKS',
  'months': 'MTH',
  'years': 'YRS',
  'now': 'NOW',
  'soon': 'SNO',
  'later': 'LTR',
  'immediately': 'IMM',
  'urgent': 'URG',
  'delayed': 'DLY',
  'scheduled': 'SCH',
  'estimated': 'EST',
  'actual': 'ACT',
  'start': 'STR',
  'end': 'END',
  'begin': 'BGN',
  'finish': 'FIN',
  'complete': 'CMP',
  'ongoing': 'ONG',
  'pending': 'PND',
  'completed': 'CMP',
  'cancelled': 'CNC',
  'suspended': 'SPD',
  'resumed': 'RSM',
};

// Reverse dictionary for decompression
const REVERSE_DICTIONARY = Object.entries(SOS_DICTIONARY).reduce((acc, [key, value]) => {
  acc[value] = key;
  return acc;
}, {});

/**
 * Compress SOS message text using dictionary substitution
 * @param {string} text - Original SOS message text
 * @returns {string} - Compressed text
 */
export function compressSOSMessage(text) {
  if (!text || typeof text !== 'string') return '';
  
  let compressed = text.toLowerCase();
  
  // Replace dictionary terms with abbreviations
  Object.entries(SOS_DICTIONARY).forEach(([full, abbrev]) => {
    const regex = new RegExp(`\\b${full}\\b`, 'gi');
    compressed = compressed.replace(regex, abbrev);
  });
  
  // Remove extra spaces and normalize
  compressed = compressed.replace(/\s+/g, ' ').trim();
  
  // Add compression marker
  return `§${compressed}`;
}

/**
 * Decompress SOS message text using reverse dictionary
 * @param {string} compressed - Compressed SOS message text
 * @returns {string} - Decompressed original text
 */
export function decompressSOSMessage(compressed) {
  if (!compressed || typeof compressed !== 'string') return '';
  
  // Remove compression marker if present
  let text = compressed.startsWith('§') ? compressed.substring(1) : compressed;
  
  // Replace abbreviations with full terms
  Object.entries(REVERSE_DICTIONARY).forEach(([abbrev, full]) => {
    const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
    text = text.replace(regex, full);
  });
  
  // Capitalize first letter for readability
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  
  return text;
}

/**
 * Ultra-lightweight numeric compression for coordinates and measurements
 * @param {number} value - Numeric value to compress
 * @param {number} precision - Decimal precision (default: 4)
 * @returns {string} - Compressed numeric string
 */
export function compressNumber(value, precision = 4) {
  if (typeof value !== 'number') return '';
  
  // Convert to string with specified precision
  const str = value.toFixed(precision);
  
  // Remove decimal point and leading zeros for ultra-compression
  const parts = str.split('.');
  const integer = parts[0];
  const decimal = parts[1] || '';
  
  // Use base36 encoding for even smaller representation
  const encodedInt = parseInt(integer).toString(36);
  const encodedDec = decimal ? parseInt(decimal).toString(36) : '';
  
  return `${encodedInt}.${encodedDec}`;
}

/**
 * Decompress ultra-lightweight numeric string
 * @param {string} compressed - Compressed numeric string
 * @param {number} precision - Original decimal precision (default: 4)
 * @returns {number} - Decompressed numeric value
 */
export function decompressNumber(compressed, precision = 4) {
  if (!compressed || typeof compressed !== 'string') return 0;
  
  try {
    const parts = compressed.split('.');
    const encodedInt = parts[0];
    const encodedDec = parts[1] || '';
    
    // Decode from base36
    const integer = parseInt(encodedInt, 36);
    let decimal = 0;
    
    if (encodedDec) {
      const decValue = parseInt(encodedDec, 36);
      decimal = decValue / Math.pow(10, precision);
    }
    
    return integer + decimal;
  } catch (error) {
    console.error('Number decompression error:', error);
    return 0;
  }
}

/**
 * Compress complete SOS message object into ultra-lightweight string
 * @param {object} sosData - SOS message data object
 * @returns {string} - Ultra-compressed string
 */
export function compressSOSData(sosData) {
  if (!sosData || typeof sosData !== 'object') return '';
  
  const parts = [];
  
  // Compress type
  if (sosData.type) {
    parts.push(`T:${compressSOSMessage(sosData.type)}`);
  }
  
  // Compress location
  if (sosData.location) {
    parts.push(`L:${compressSOSMessage(sosData.location)}`);
  }
  
  // Compress coordinates
  if (sosData.latitude !== undefined && sosData.longitude !== undefined) {
    parts.push(`C:${compressNumber(sosData.latitude)},${compressNumber(sosData.longitude)}`);
  }
  
  // Compress status
  if (sosData.status) {
    parts.push(`S:${compressSOSMessage(sosData.status)}`);
  }
  
  // Compress priority
  if (sosData.priority) {
    parts.push(`P:${compressSOSMessage(sosData.priority)}`);
  }
  
  // Compress message
  if (sosData.message) {
    parts.push(`M:${compressSOSMessage(sosData.message)}`);
  }
  
  // Compress timestamp
  if (sosData.timestamp) {
    parts.push(`TS:${sosData.timestamp}`);
  }
  
  // Compress unit ID
  if (sosData.unitId) {
    parts.push(`U:${sosData.unitId}`);
  }
  
  return parts.join('|');
}

/**
 * Decompress ultra-lightweight SOS string into complete object
 * @param {string} compressed - Ultra-compressed SOS string
 * @returns {object} - Decompressed SOS data object
 */
export function decompressSOSData(compressed) {
  if (!compressed || typeof compressed !== 'string') return {};
  
  const result = {};
  const parts = compressed.split('|');
  
  parts.forEach(part => {
    const [key, value] = part.split(':');
    
    switch (key) {
      case 'T':
        result.type = decompressSOSMessage(value);
        break;
      case 'L':
        result.location = decompressSOSMessage(value);
        break;
      case 'C':
        const coords = value.split(',');
        result.latitude = decompressNumber(coords[0]);
        result.longitude = decompressNumber(coords[1]);
        break;
      case 'S':
        result.status = decompressSOSMessage(value);
        break;
      case 'P':
        result.priority = decompressSOSMessage(value);
        break;
      case 'M':
        result.message = decompressSOSMessage(value);
        break;
      case 'TS':
        result.timestamp = value;
        break;
      case 'U':
        result.unitId = value;
        break;
    }
  });
  
  return result;
}

/**
 * Calculate compression ratio
 * @param {string} original - Original text
 * @param {string} compressed - Compressed text
 * @returns {number} - Compression ratio (0-1, lower is better)
 */
export function getCompressionRatio(original, compressed) {
  if (!original || !compressed) return 0;
  return compressed.length / original.length;
}

/**
 * Test compression/decompression with sample SOS data
 * @returns {object} - Test results with compression ratio
 */
export function testCompression() {
  const sampleSOS = {
    type: 'SOS',
    message: 'Medical emergency required immediate assistance at building 4 floor 3 room 12. Multiple casualties reported. Critical priority.',
    location: 'Building 4, Floor 3, Room 12',
    latitude: 40.7128,
    longitude: -74.0060,
    status: 'critical',
    priority: 'urgent',
    timestamp: Date.now(),
    unitId: 'UNIT_ALPHA',
  };

  const originalText = JSON.stringify(sampleSOS);
  const compressed = compressSOSData(sampleSOS);
  const decompressed = decompressSOSData(compressed);
  const ratio = getCompressionRatio(originalText, compressed);

  return {
    original: originalText,
    compressed: compressed,
    decompressed: decompressed,
    originalLength: originalText.length,
    compressedLength: compressed.length,
    compressionRatio: ratio,
    compressionPercentage: ((1 - ratio) * 100).toFixed(2),
    success: JSON.stringify(decompressed) === JSON.stringify(sampleSOS),
  };
}
