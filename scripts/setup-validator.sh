#!/bin/bash

echo "🛠️ Setting up Parking Data Validator..."

# Create required directories
mkdir -p data/{backups,reports,logs,test}

# Install dependencies
if [ -f "package.json" ]; then
    npm install
else
    echo "⚠️ package.json not found. Creating minimal setup..."
    npm init -y
    npm install minimist chalk dayjs
fi

# Make scripts executable
chmod +x scripts/*.js

# Create initial data file if doesn't exist
if [ ! -f "data/parkir-data.json" ]; then
    echo "📁 Creating initial data structure..."
    cat > data/parkir-data.json << EOF
{
  "locations": [],
  "statistics": {
    "capacity": { "bus": 0, "mobil": 0, "motor": 0, "total": 0 },
    "available": { "bus": 0, "mobil": 0, "motor": 0, "total": 0 },
    "utilization": { "bus": "0.0", "mobil": "0.0", "motor": "0.0", "overall": "0.0" },
    "metadata": {
      "lastUpdated": "$(date -Iseconds)",
      "totalLocations": 0,
      "validationMode": "none"
    }
  }
}
EOF
fi

# Create sample test data
cat > data/test-data.json << EOF
{
  "locations": [
    {
      "name": "Parkir Utama",
      "bus": { "total": 20, "available": 5 },
      "mobil": { "total": 100, "available": 30 },
      "motor": { "total": 200, "available": 150 }
    },
    {
      "name": "Parkir Timur",
      "bus": { "total": 10, "available": 8 },
      "mobil": { "total": 50, "available": 20 },
      "motor": { "total": 100, "available": 80 }
    }
  ],
  "statistics": {}
}
EOF

echo "✅ Setup completed!"
echo ""
echo "Usage:"
echo "  npm run validate           # Run validation"
echo "  npm run validate:dry-run   # Dry run mode"
echo "  npm run validate:fix       # Fix issues automatically"
echo ""
echo "Configuration:"
echo "  Edit scripts/validate-parking.js for settings"
echo "  Data file: data/parkir-data.json"
echo "  Reports: data/reports/"
echo "  Backups: data/backups/"
