const fs = require('fs');

const kml = fs.readFileSync('data.kml', 'utf8');

const dpPoints = [];
const cableSegs = [];

// Split by Placemark
const placemarks = kml.split('<Placemark>');
placemarks.shift(); // Remove content before first Placemark

placemarks.forEach(pm => {
  const nameMatch = pm.match(/<name>(.*?)<\/name>/);
  const name = nameMatch ? nameMatch[1] : '';
  
  const descMatch = pm.match(/<description>(.*?)<\/description>/);
  const desc = descMatch ? descMatch[1] : '';

  // Check for Point
  const pointMatch = pm.match(/<Point>[\s\S]*?<coordinates>(.*?)<\/coordinates>[\s\S]*?<\/Point>/);
  if (pointMatch) {
    const coords = pointMatch[1].trim().split(',');
    if (coords.length >= 2) {
      dpPoints.push({
        id: dpPoints.length,
        name: name,
        desc: desc,
        lat: parseFloat(coords[1]),
        lng: parseFloat(coords[0])
      });
    }
    return;
  }

  // Check for LineString
  const lineMatch = pm.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/);
  if (lineMatch) {
    const coordsList = lineMatch[1].trim().split(/\s+/).filter(Boolean);
    const segment = coordsList.map(s => {
      const parts = s.split(',');
      return { lat: parseFloat(parts[1]), lng: parseFloat(parts[0]) };
    });
    if (segment.length >= 2) {
      cableSegs.push(segment);
    }
  }
});

const output = `/* Generated Data */
const KML_DP_POINTS = ${JSON.stringify(dpPoints, null, 2)};
const KML_CABLE_SEGS = ${JSON.stringify(cableSegs, null, 2)};
`;

fs.writeFileSync('data.js', output);
console.log(`Successfully generated data.js: ${dpPoints.length} DPs, ${cableSegs.length} Segments`);
