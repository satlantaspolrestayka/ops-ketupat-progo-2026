#!/usr/bin/env node

/**
 * Parking Data Validator - Full Features Version
 * Validates, fixes, and reports on parking data statistics
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Command line arguments parser
const args = require('minimist')(process.argv.slice(2), {
  string: ['mode', 'log-level', 'threshold'],
  number: ['max-backups'],
  boolean: ['dry-run', 'force', 'verbose', 'backup'],
  alias: {
    m: 'mode',
    t: 'threshold',
    b: 'max-backups',
    d: 'dry-run',
    f: 'force',
    v: 'verbose',
    l: 'log-level'
  },
  default: {
    mode: 'strict',
    'max-backups': 10,
    threshold: 85,
    'dry-run': false,
    force: false,
    verbose: false,
    backup: true,
    'log-level': 'info'
  }
});

class ParkingDataValidator {
  constructor(config = {}) {
    this.config = {
      // File paths
      dataPath: path.resolve(__dirname, '../data/parkir-data.json'),
      backupDir: path.resolve(__dirname, '../data/backups'),
      reportDir: path.resolve(__dirname, '../data/reports'),
      logDir: path.resolve(__dirname, '../data/logs'),
      
      // Validation settings
      allowedVehicleTypes: ['bus', 'mobil', 'motor'],
      minCapacity: 0,
      maxCapacity: 1000,
      
      // Notification thresholds
      utilizationWarning: 80,  // 80% - warning level
      utilizationCritical: 95, // 95% - critical level
      capacityThreshold: 10,   // Minimum capacity to consider
      
      // Performance settings
      maxProcessingTime: 30000, // 30 seconds
      batchSize: 50,           // Process locations in batches
      
      // Merge with user config
      ...config,
      ...args
    };
    
    // Initialize state
    this.metrics = {
      startTime: Date.now(),
      locationsProcessed: 0,
      issuesFound: 0,
      warnings: 0,
      fixesApplied: 0,
      processingTime: 0
    };
    
    this.results = {
      totals: { bus: 0, mobil: 0, motor: 0, total: 0 },
      available: { bus: 0, mobil: 0, motor: 0, total: 0 },
      utilization: { bus: 0, mobil: 0, motor: 0, overall: 0 },
      issues: [],
      warnings: [],
      fixes: [],
      recommendations: []
    };
    
    // Ensure directories exist
    this.ensureDirectories();
    
    // Setup logger
    this.setupLogger();
  }

  /**
   * Ensure all required directories exist
   */
  ensureDirectories() {
    const dirs = [
      this.config.backupDir,
      this.config.reportDir,
      this.config.logDir,
      path.dirname(this.config.dataPath)
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.log('info', `Created directory: ${dir}`);
      }
    });
  }

  /**
   * Setup logging system
   */
  setupLogger() {
    const logLevels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    
    this.logLevel = logLevels[this.config['log-level']] || 2;
    
    this.logger = {
      error: (message, data) => this.log('error', message, data),
      warn: (message, data) => this.log('warn', message, data),
      info: (message, data) => this.log('info', message, data),
      debug: (message, data) => this.log('debug', message, data)
    };
  }

  /**
   * Log message with timestamp and level
   */
  log(level, message, data = null) {
    const logLevels = { error: 0, warn: 1, info: 2, debug: 3 };
    const currentLevel = logLevels[level];
    
    if (currentLevel <= this.logLevel) {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        message,
        ...(data && { data })
      };
      
      // Console output with colors
      const colors = {
        ERROR: '\x1b[31m', // Red
        WARN: '\x1b[33m',  // Yellow
        INFO: '\x1b[36m',  // Cyan
        DEBUG: '\x1b[90m', // Gray
        RESET: '\x1b[0m'   // Reset
      };
      
      const color = colors[level.toUpperCase()] || '';
      console.log(`${color}[${timestamp}] ${level.toUpperCase()}: ${message}${colors.RESET}`);
      
      if (data && this.config.verbose) {
        console.log(JSON.stringify(data, null, 2));
      }
      
      // File logging
      this.writeToLogFile(logEntry);
    }
  }

  /**
   * Write log entry to file
   */
  writeToLogFile(entry) {
    const logFile = path.join(this.config.logDir, `validation-${new Date().toISOString().split('T')[0]}.log`);
    const logLine = JSON.stringify(entry) + '\n';
    
    try {
      fs.appendFileSync(logFile, logLine);
    } catch (error) {
      console.error('Failed to write log:', error.message);
    }
  }

  /**
   * Main validation process
   */
  async validate() {
    try {
      this.logger.info('Starting parking data validation');
      
      // Create backup
      if (this.config.backup) {
        await this.createBackup();
      }
      
      // Load and validate data
      const data = await this.loadData();
      
      // Process data
      await this.processData(data);
      
      // Generate reports
      const report = await this.generateReport(data);
      
      // Cleanup old files
      await this.cleanup();
      
      this.metrics.processingTime = Date.now() - this.metrics.startTime;
      
      this.logger.info(`Validation completed in ${this.metrics.processingTime}ms`);
      this.logger.info(`Processed ${this.metrics.locationsProcessed} locations`);
      this.logger.info(`Found ${this.metrics.issuesFound} issues, applied ${this.metrics.fixesApplied} fixes`);
      
      return {
        success: true,
        report,
        metrics: this.metrics,
        results: this.results
      };
      
    } catch (error) {
      this.logger.error('Validation failed', { error: error.message, stack: error.stack });
      
      return {
        success: false,
        error: error.message,
        metrics: this.metrics,
        results: this.results
      };
    }
  }

  /**
   * Create backup of current data
   */
  async createBackup() {
    if (this.config['dry-run']) {
      this.logger.info('Dry-run mode: Skipping backup');
      return;
    }
    
    if (!fs.existsSync(this.config.dataPath)) {
      throw new Error(`Data file not found: ${this.config.dataPath}`);
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.config.backupDir, `parkir-data-backup-${timestamp}.json`);
    
    try {
      const data = fs.readFileSync(this.config.dataPath, 'utf8');
      fs.writeFileSync(backupFile, data);
      
      this.logger.info(`Backup created: ${backupFile}`);
      
      // Add to results
      this.results.backup = {
        file: backupFile,
        timestamp,
        size: Buffer.byteLength(data, 'utf8')
      };
      
    } catch (error) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Load and validate data structure
   */
  async loadData() {
    this.logger.debug('Loading data file');
    
    try {
      const rawData = fs.readFileSync(this.config.dataPath, 'utf8');
      const data = JSON.parse(rawData);
      
      // Validate structure
      this.validateStructure(data);
      
      this.logger.info(`Data loaded: ${data.locations?.length || 0} locations`);
      
      return data;
      
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON format: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Validate data structure
   */
  validateStructure(data) {
    const errors = [];
    
    // Check for required fields
    if (!data.locations || !Array.isArray(data.locations)) {
      errors.push('Data must contain "locations" array');
    }
    
    if (!data.statistics || typeof data.statistics !== 'object') {
      errors.push('Data must contain "statistics" object');
    }
    
    // Validate each location
    if (data.locations && Array.isArray(data.locations)) {
      data.locations.forEach((location, index) => {
        if (!location.name) {
          errors.push(`Location at index ${index} missing "name"`);
        }
        
        this.config.allowedVehicleTypes.forEach(type => {
          if (!location[type]) {
            this.logger.warn(`Location "${location.name}" missing "${type}" data`);
            location[type] = { total: 0, available: 0 };
          }
        });
      });
    }
    
    if (errors.length > 0) {
      throw new Error(`Data structure validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Process all locations and calculate statistics
   */
  async processData(data) {
    this.logger.info('Processing locations data');
    
    // Process in batches for large datasets
    const locations = data.locations;
    const batchSize = this.config.batchSize;
    
    for (let i = 0; i < locations.length; i += batchSize) {
      const batch = locations.slice(i, i + batchSize);
      await this.processBatch(batch, data);
      
      // Check processing time
      if (Date.now() - this.metrics.startTime > this.config.maxProcessingTime) {
        throw new Error('Processing timeout exceeded');
      }
    }
    
    // Update statistics
    this.updateStatistics(data);
    
    // Save changes if not in dry-run mode
    if (!this.config['dry-run']) {
      await this.saveData(data);
    }
  }

  /**
   * Process a batch of locations
   */
  async processBatch(batch, data) {
    for (const location of batch) {
      this.metrics.locationsProcessed++;
      
      const locationIssues = [];
      const locationFixes = [];
      
      // Process each vehicle type
      for (const vehicleType of this.config.allowedVehicleTypes) {
        const result = this.processVehicleType(location, vehicleType);
        
        if (result.issues.length > 0) {
          locationIssues.push(...result.issues);
          this.metrics.issuesFound += result.issues.length;
        }
        
        if (result.fixes.length > 0) {
          locationFixes.push(...result.fixes);
          this.metrics.fixesApplied += result.fixes.length;
        }
        
        // Update running totals
        this.results.totals[vehicleType] += location[vehicleType].total;
        this.results.available[vehicleType] += location[vehicleType].available;
      }
      
      // Update location metadata
      location.lastValidated = new Date().toISOString();
      location.validationIssues = locationIssues.length;
      
      // Record issues and fixes
      if (locationIssues.length > 0) {
        this.results.issues.push({
          location: location.name,
          issues: locationIssues
        });
      }
      
      if (locationFixes.length > 0) {
        this.results.fixes.push({
          location: location.name,
          fixes: locationFixes
        });
      }
      
      // Add recommendations
      const recommendations = this.generateRecommendations(location);
      if (recommendations.length > 0) {
        this.results.recommendations.push({
          location: location.name,
          recommendations
        });
      }
    }
  }

  /**
   * Process individual vehicle type data
   */
  processVehicleType(location, vehicleType) {
    const result = { issues: [], fixes: [] };
    const vehicleData = location[vehicleType];
    
    // Ensure data structure
    if (!vehicleData || typeof vehicleData !== 'object') {
      vehicleData = { total: 0, available: 0 };
      location[vehicleType] = vehicleData;
      result.fixes.push(`Created missing ${vehicleType} data structure`);
    }
    
    // Parse and validate values
    const originalTotal = vehicleData.total;
    const originalAvailable = vehicleData.available;
    
    const total = this.parseNumber(vehicleData.total, 0);
    const available = this.parseNumber(vehicleData.available, 0);
    
    // Apply validation rules
    if (total < this.config.minCapacity) {
      result.issues.push(`${vehicleType}: Total capacity (${total}) below minimum (${this.config.minCapacity})`);
      if (this.config.force) {
        vehicleData.total = this.config.minCapacity;
        result.fixes.push(`Forced total capacity to minimum: ${this.config.minCapacity}`);
      }
    }
    
    if (total > this.config.maxCapacity) {
      result.issues.push(`${vehicleType}: Total capacity (${total}) exceeds maximum (${this.config.maxCapacity})`);
      if (this.config.force) {
        vehicleData.total = this.config.maxCapacity;
        result.fixes.push(`Capped total capacity to maximum: ${this.config.maxCapacity}`);
      }
    }
    
    if (available < 0) {
      result.issues.push(`${vehicleType}: Negative available spaces (${available})`);
      vehicleData.available = 0;
      result.fixes.push(`Fixed negative available spaces to 0`);
    }
    
    if (available > total) {
      result.issues.push(`${vehicleType}: Available (${available}) exceeds total (${total})`);
      vehicleData.available = total;
      result.fixes.push(`Fixed available spaces to match total: ${total}`);
    }
    
    // Update with validated values
    vehicleData.total = vehicleData.total || total;
    vehicleData.available = vehicleData.available || Math.min(available, vehicleData.total);
    
    // Check if values were changed
    if (originalTotal !== vehicleData.total || originalAvailable !== vehicleData.available) {
      result.fixes.push(`Updated ${vehicleType}: ${originalTotal}→${vehicleData.total}, ${originalAvailable}→${vehicleData.available}`);
    }
    
    return result;
  }

  /**
   * Safe number parsing
   */
  parseNumber(value, defaultValue = 0) {
    if (value === null || value === undefined || value === '') {
      return defaultValue;
    }
    
    const num = Number(value);
    
    if (isNaN(num)) {
      this.logger.warn(`Invalid number value: ${value}, using default: ${defaultValue}`);
      return defaultValue;
    }
    
    // Round to nearest integer for parking spaces
    return Math.max(0, Math.round(num));
  }

  /**
   * Generate recommendations for a location
   */
  generateRecommendations(location) {
    const recommendations = [];
    
    this.config.allowedVehicleTypes.forEach(type => {
      const data = location[type];
      const utilization = data.total > 0 ? ((data.total - data.available) / data.total) * 100 : 0;
      
      if (data.total > 0 && utilization >= this.config.utilizationCritical) {
        recommendations.push(`${type}: Critical utilization (${utilization.toFixed(1)}%) - Consider adding capacity`);
      } else if (data.total > 0 && utilization >= this.config.utilizationWarning) {
        recommendations.push(`${type}: High utilization (${utilization.toFixed(1)}%) - Monitor closely`);
      }
      
      if (data.total === 0 && data.available === 0) {
        recommendations.push(`${type}: No capacity defined - Consider adding parking spaces`);
      }
    });
    
    return recommendations;
  }

  /**
   * Update global statistics
   */
  updateStatistics(data) {
    // Calculate totals
    this.results.totals.total = Object.values(this.results.totals).reduce((a, b) => a + b, 0);
    this.results.available.total = Object.values(this.results.available).reduce((a, b) => a + b, 0);
    
    // Calculate utilization percentages
    this.config.allowedVehicleTypes.forEach(type => {
      if (this.results.totals[type] > 0) {
        this.results.utilization[type] = 
          ((this.results.totals[type] - this.results.available[type]) / this.results.totals[type]) * 100;
      }
    });
    
    if (this.results.totals.total > 0) {
      this.results.utilization.overall = 
        ((this.results.totals.total - this.results.available.total) / this.results.totals.total) * 100;
    }
    
    // Update data statistics
    data.statistics = {
      // Capacity data
      capacity: {
        bus: this.results.totals.bus,
        mobil: this.results.totals.mobil,
        motor: this.results.totals.motor,
        total: this.results.totals.total
      },
      
      // Availability data
      available: {
        bus: this.results.available.bus,
        mobil: this.results.available.mobil,
        motor: this.results.available.motor,
        total: this.results.available.total
      },
      
      // Utilization data
      utilization: {
        bus: this.results.utilization.bus.toFixed(1),
        mobil: this.results.utilization.mobil.toFixed(1),
        motor: this.results.utilization.motor.toFixed(1),
        overall: this.results.utilization.overall.toFixed(1)
      },
      
      // Metadata
      metadata: {
        lastUpdated: new Date().toISOString(),
        validatedAt: new Date().toISOString(),
        totalLocations: data.locations.length,
        validationMode: this.config.mode,
        issuesFound: this.metrics.issuesFound,
        fixesApplied: this.metrics.fixesApplied
      },
      
      // Performance metrics
      performance: {
        updateCount: (data.statistics?.metadata?.updateCount || 0) + 1,
        lastProcessingTime: this.metrics.processingTime
      }
    };
    
    this.logger.info('Statistics updated successfully');
  }

  /**
   * Save processed data
   */
  async saveData(data) {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      fs.writeFileSync(this.config.dataPath, jsonString);
      
      this.logger.info(`Data saved to: ${this.config.dataPath}`);
      this.logger.debug(`File size: ${Buffer.byteLength(jsonString, 'utf8')} bytes`);
      
    } catch (error) {
      throw new Error(`Failed to save data: ${error.message}`);
    }
  }

  /**
   * Generate comprehensive report
   */
  async generateReport(data) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total_locations: data.locations.length,
        total_capacity: this.results.totals.total,
        total_available: this.results.available.total,
        utilization_percent: this.results.utilization.overall.toFixed(1),
        issues_found: this.metrics.issuesFound,
        fixes_applied: this.metrics.fixesApplied,
        processing_time_ms: this.metrics.processingTime
      },
      
      details: {
        by_vehicle_type: this.config.allowedVehicleTypes.reduce((acc, type) => {
          acc[type] = {
            capacity: this.results.totals[type],
            available: this.results.available[type],
            utilization: this.results.utilization[type].toFixed(1)
          };
          return acc;
        }, {}),
        
        top_utilized_locations: this.getTopUtilizedLocations(data, 5),
        most_available_locations: this.getMostAvailableLocations(data, 5),
        
        issues_by_severity: {
          critical: this.results.issues.filter(i => 
            i.issues.some(issue => issue.includes('Critical') || issue.includes('exceeds'))
          ).length,
          warning: this.results.issues.filter(i => 
            i.issues.some(issue => issue.includes('Warning') || issue.includes('High'))
          ).length,
          info: this.results.issues.length
        }
      },
      
      issues_fixed: this.results.fixes,
      recommendations: this.results.recommendations,
      
      metadata: {
        validator_version: '2.0.0',
        config: {
          mode: this.config.mode,
          max_backups: this.config['max-backups'],
          threshold: this.config.threshold
        },
        git_info: this.getGitInfo(),
        system_info: {
          node_version: process.version,
          platform: process.platform,
          memory_usage: process.memoryUsage()
        }
      }
    };
    
    // Save report to file
    const reportFile = path.join(this.config.reportDir, `validation-report-${new Date().toISOString().split('T')[0]}.json`);
    const latestReport = path.join(this.config.reportDir, 'validation-report-latest.json');
    
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    fs.writeFileSync(latestReport, JSON.stringify(report, null, 2));
    
    this.logger.info(`Report generated: ${reportFile}`);
    
    // Generate human-readable summary
    await this.generateTextSummary(report);
    
    return report;
  }

  /**
   * Get top utilized locations
   */
  getTopUtilizedLocations(data, limit = 5) {
    return data.locations
      .map(location => {
        let totalCapacity = 0;
        let totalAvailable = 0;
        
        this.config.allowedVehicleTypes.forEach(type => {
          totalCapacity += location[type]?.total || 0;
          totalAvailable += location[type]?.available || 0;
        });
        
        const utilization = totalCapacity > 0 ? 
          ((totalCapacity - totalAvailable) / totalCapacity) * 100 : 0;
        
        return {
          name: location.name,
          capacity: totalCapacity,
          available: totalAvailable,
          utilization: utilization.toFixed(1)
        };
      })
      .filter(loc => loc.capacity > 0)
      .sort((a, b) => b.utilization - a.utilization)
      .slice(0, limit);
  }

  /**
   * Get locations with most available spaces
   */
  getMostAvailableLocations(data, limit = 5) {
    return data.locations
      .map(location => {
        let totalAvailable = 0;
        
        this.config.allowedVehicleTypes.forEach(type => {
          totalAvailable += location[type]?.available || 0;
        });
        
        return {
          name: location.name,
          available: totalAvailable
        };
      })
      .sort((a, b) => b.available - a.available)
      .slice(0, limit);
  }

  /**
   * Get Git repository information
   */
  getGitInfo() {
    try {
      return {
        branch: execSync('git branch --show-current', { encoding: 'utf8' }).trim(),
        commit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
        commit_short: execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(),
        last_commit_message: execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim()
      };
    } catch (error) {
      return { error: 'Git information unavailable' };
    }
  }

  /**
   * Generate human-readable text summary
   */
  async generateTextSummary(report) {
    const summaryFile = path.join(this.config.reportDir, 'validation-summary.txt');
    
    const summary = `
PARKING DATA VALIDATION SUMMARY
================================
Generated: ${new Date(report.timestamp).toLocaleString()}

OVERVIEW
--------
• Total Locations: ${report.summary.total_locations}
• Total Capacity: ${report.summary.total_capacity} spaces
• Available Spaces: ${report.summary.total_available}
• Utilization Rate: ${report.summary.utilization_percent}%
• Processing Time: ${report.summary.processing_time_ms}ms
• Issues Found: ${report.summary.issues_found}
• Fixes Applied: ${report.summary.fixes_applied}

BY VEHICLE TYPE
---------------
${this.config.allowedVehicleTypes.map(type => {
  const details = report.details.by_vehicle_type[type];
  return `• ${type.toUpperCase()}: ${details.available}/${details.capacity} available (${details.utilization}% utilized)`;
}).join('\n')}

TOP UTILIZED LOCATIONS (${report.details.top_utilized_locations.length})
------------------------
${report.details.top_utilized_locations.map((loc, i) => 
  `${i + 1}. ${loc.name}: ${loc.utilization}% (${loc.available}/${loc.capacity})`
).join('\n')}

ISSUES SUMMARY
--------------
• Critical: ${report.details.issues_by_severity.critical}
• Warning: ${report.details.issues_by_severity.warning}
• Info: ${report.details.issues_by_severity.info}

RECOMMENDATIONS
---------------
${report.recommendations.length > 0 ? 
  report.recommendations.map(rec => 
    `• ${rec.location}: ${rec.recommendations.join(', ')}`
  ).join('\n') : 
  'No recommendations at this time.'}

VALIDATION CONFIG
-----------------
• Mode: ${report.metadata.config.mode}
• Threshold: ${report.metadata.config.threshold}%
• Max Backups: ${report.metadata.config.max_backups}

================================
Validation completed successfully
    `;
    
    fs.writeFileSync(summaryFile, summary.trim());
    this.logger.info(`Text summary generated: ${summaryFile}`);
  }

  /**
   * Cleanup old backup and report files
   */
  async cleanup() {
    if (this.config['dry-run']) {
      return;
    }
    
    try {
      // Cleanup old backups
      const maxBackups = this.config['max-backups'];
      const backupFiles = fs.readdirSync(this.config.backupDir)
        .filter(file => file.startsWith('parkir-data-backup-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(this.config.backupDir, file),
          time: fs.statSync(path.join(this.config.backupDir, file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);
      
      if (backupFiles.length > maxBackups) {
        const toDelete = backupFiles.slice(maxBackups);
        toDelete.forEach(file => {
          fs.unlinkSync(file.path);
          this.logger.debug(`Removed old backup: ${file.name}`);
        });
      }
      
      // Cleanup old reports (keep last 30 days)
      const reportFiles = fs.readdirSync(this.config.reportDir)
        .filter(file => file.startsWith('validation-report-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(this.config.reportDir, file),
          time: fs.statSync(path.join(this.config.reportDir, file)).mtime.getTime()
        }));
      
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const oldReports = reportFiles.filter(file => file.time < thirtyDaysAgo);
      
      oldReports.forEach(file => {
        if (file.name !== 'validation-report-latest.json') {
          fs.unlinkSync(file.path);
          this.logger.debug(`Removed old report: ${file.name}`);
        }
      });
      
    } catch (error) {
      this.logger.warn('Cleanup failed', { error: error.message });
    }
  }

  /**
   * Print final report to console
   */
  printConsoleReport(report) {
    console.log('\n' + '='.repeat(80));
    console.log('🎯 PARKING DATA VALIDATION - FINAL REPORT');
    console.log('='.repeat(80));
    
    console.log(`\n📊 SUMMARY`);
    console.log(`   Locations: ${report.summary.total_locations}`);
    console.log(`   Total Capacity: ${report.summary.total_capacity}`);
    console.log(`   Available: ${report.summary.total_available}`);
    console.log(`   Utilization: ${report.summary.utilization_percent}%`);
    console.log(`   Issues Fixed: ${report.summary.fixes_applied}`);
    
    console.log(`\n🚗 VEHICLE BREAKDOWN`);
    this.config.allowedVehicleTypes.forEach(type => {
      const details = report.details.by_vehicle_type[type];
      const icon = details.utilization >= 90 ? '🔴' : details.utilization >= 70 ? '🟡' : '🟢';
      console.log(`   ${icon} ${type.toUpperCase()}: ${details.available}/${details.capacity} (${details.utilization}%)`);
    });
    
    if (report.recommendations.length > 0) {
      console.log(`\n💡 RECOMMENDATIONS`);
      report.recommendations.forEach(rec => {
        console.log(`   • ${rec.location}: ${rec.recommendations.join(', ')}`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`✅ Validation completed at ${new Date().toLocaleTimeString()}`);
    console.log('='.repeat(80) + '\n');
  }
}

// Main execution
(async () => {
  try {
    const validator = new ParkingDataValidator();
    const result = await validator.validate();
    
    if (result.success) {
      validator.printConsoleReport(result.report);
      process.exit(0);
    } else {
      console.error('\n❌ Validation failed:', result.error);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  }
})();
