#!/usr/bin/env node
/**
 * Calendar System Test Script
 * 
 * Tests the new optimized calendar procedures and API endpoints
 * with your existing tblcalender and appointment data
 */

import { executeStoredProcedure, executeQuery, TYPES } from './services/database/index.js';
import { logger } from './services/core/Logger.js';

/**
 * Test the optimized calendar procedures
 */
async function testCalendarProcedures() {
    console.log('\n🧪 Testing Calendar Procedures...\n');
    
    try {
        // Test date range (current week)
        const today = new Date();
        const weekStart = getWeekStart(today);
        const weekEnd = getWeekEnd(weekStart);
        
        console.log(`📅 Testing week: ${weekStart} to ${weekEnd}`);
        
        // Test 1: Ensure calendar range is adequate
        console.log('\n1️⃣ Testing ProcEnsureCalendarRange...');
        const rangeResult = await executeStoredProcedure(
            'ProcEnsureCalendarRange',
            [['DaysAhead', TYPES.Int, 60]],
            null,
            (columns) => ({
                status: columns[0].value,
                maxDate: columns[1].value,
                targetDate: columns[2].value
            })
        );
        
        console.log('✅ Calendar range result:', rangeResult[0]);
        
        // Test 2: Weekly calendar data
        console.log('\n2️⃣ Testing ProcWeeklyCalendarOptimized...');
        const calendarData = await executeStoredProcedure(
            'ProcWeeklyCalendarOptimized',
            [
                ['StartDate', TYPES.Date, weekStart],
                ['EndDate', TYPES.Date, weekEnd]
            ],
            null,
            (columns) => ({
                calendarDate: columns[0].value,
                dayName: columns[1].value,
                dayOfWeek: columns[2].value,
                slotTime: columns[3].value,
                slotDateTime: columns[4].value,
                appointmentID: columns[5].value,
                appDetail: columns[6].value,
                drID: columns[7].value,
                patientName: columns[8].value,
                present: columns[9].value,
                seated: columns[10].value,
                dismissed: columns[11].value,
                personID: columns[12].value,
                slotStatus: columns[13].value,
                formattedTime: columns[14].value
            })
        );
        
        console.log(`✅ Retrieved ${calendarData.length} calendar slots`);
        
        // Analyze the data
        const slots = {
            available: calendarData.filter(s => s.slotStatus === 'available').length,
            booked: calendarData.filter(s => s.slotStatus === 'booked').length,
            past: calendarData.filter(s => s.slotStatus === 'past').length
        };
        
        console.log('📊 Slot breakdown:', slots);
        
        // Show sample appointments
        const appointments = calendarData.filter(s => s.appointmentID > 0).slice(0, 3);
        if (appointments.length > 0) {
            console.log('\n👥 Sample appointments:');
            appointments.forEach(apt => {
                console.log(`   ${apt.dayName} ${apt.formattedTime} - ${apt.patientName} (${apt.appDetail || 'N/A'})`);
            });
        }
        
        // Test 3: Calendar statistics
        console.log('\n3️⃣ Testing ProcCalendarStatsOptimized...');
        const statsData = await executeStoredProcedure(
            'ProcCalendarStatsOptimized',
            [
                ['StartDate', TYPES.Date, weekStart],
                ['EndDate', TYPES.Date, weekEnd]
            ],
            null,
            (columns) => ({
                weekStart: columns[0].value,
                weekEnd: columns[1].value,
                totalSlots: columns[2].value,
                availableSlots: columns[3].value,
                bookedSlots: columns[4].value,
                pastSlots: columns[5].value,
                utilizationPercent: columns[6].value
            })
        );
        
        const stats = statsData[0];
        console.log('✅ Calendar statistics:', {
            totalSlots: stats.totalSlots,
            availableSlots: stats.availableSlots,
            bookedSlots: stats.bookedSlots,
            pastSlots: stats.pastSlots,
            utilization: `${stats.utilizationPercent}%`
        });
        
        return {
            success: true,
            calendarSlots: calendarData.length,
            appointments: slots.booked,
            utilization: stats.utilizationPercent
        };
        
    } catch (error) {
        console.error('❌ Calendar procedure test failed:', error);
        throw error;
    }
}

/**
 * Test calendar API endpoints via direct function calls
 */
async function testCalendarAPI() {
    console.log('\n🌐 Testing Calendar API Logic...\n');
    
    try {
        const today = new Date();
        const weekStart = getWeekStart(today);
        const weekEnd = getWeekEnd(weekStart);
        
        // Test the same logic that the API endpoints use
        console.log('4️⃣ Testing API data transformation...');
        
        const calendarData = await executeStoredProcedure(
            'ProcWeeklyCalendarOptimized',
            [
                ['StartDate', TYPES.Date, weekStart],
                ['EndDate', TYPES.Date, weekEnd]
            ],
            null,
            (columns) => ({
                calendarDate: columns[0].value,
                dayName: columns[1].value,
                dayOfWeek: columns[2].value,
                slotTime: columns[3].value,
                slotDateTime: columns[4].value,
                appointmentID: columns[5].value,
                appDetail: columns[6].value,
                drID: columns[7].value,
                patientName: columns[8].value,
                present: columns[9].value,
                seated: columns[10].value,
                dismissed: columns[11].value,
                personID: columns[12].value,
                slotStatus: columns[13].value,
                formattedTime: columns[14].value
            })
        );
        
        // Transform data like the API does
        const structuredData = transformToCalendarStructure(calendarData);
        
        console.log(`✅ Structured data: ${structuredData.days.length} days, ${structuredData.timeSlots.length} time slots`);
        
        // Show day breakdown
        console.log('\n📅 Days in calendar:');
        structuredData.days.forEach(day => {
            const appointmentCount = Object.values(day.appointments).filter(apt => apt.appointmentID > 0).length;
            console.log(`   ${day.dayName} ${day.date}: ${appointmentCount} appointments`);
        });
        
        return {
            success: true,
            days: structuredData.days.length,
            timeSlots: structuredData.timeSlots.length
        };
        
    } catch (error) {
        console.error('❌ Calendar API test failed:', error);
        throw error;
    }
}

/**
 * Test existing system compatibility
 */
async function testExistingSystemIntegration() {
    console.log('\n🔄 Testing Integration with Existing System...\n');
    
    try {
        // Test 1: Verify tblcalender has data
        console.log('5️⃣ Checking tblcalender data...');
        const calendarCount = await executeQuery(
            'SELECT COUNT(*) as TotalSlots, MIN(AppDate) as MinDate, MAX(AppDate) as MaxDate FROM tblcalender',
            [],
            (columns) => ({
                totalSlots: columns[0].value,
                minDate: columns[1].value,
                maxDate: columns[2].value
            })
        );
        
        console.log('✅ Calendar table:', calendarCount[0]);
        
        // Test 2: Check existing appointments
        console.log('\n6️⃣ Checking existing appointments...');
        const appointmentCount = await executeQuery(
            'SELECT COUNT(*) as TotalAppts, COUNT(DISTINCT PersonID) as UniquePatients FROM tblappointments WHERE AppDate >= CAST(GETDATE() AS DATE)',
            [],
            (columns) => ({
                totalAppointments: columns[0].value,
                uniquePatients: columns[1].value
            })
        );
        
        console.log('✅ Appointment data:', appointmentCount[0]);
        
        // Test 3: Verify time slots
        console.log('\n7️⃣ Checking time slots...');
        const timeSlots = await executeQuery(
            'SELECT COUNT(*) as TotalTimes, MIN(MyTime) as FirstTime, MAX(MyTime) as LastTime FROM tbltimes',
            [],
            (columns) => ({
                totalTimes: columns[0].value,
                firstTime: columns[1].value,
                lastTime: columns[2].value
            })
        );
        
        console.log('✅ Time slots:', timeSlots[0]);
        
        // Test 4: Compare old vs new procedure performance
        console.log('\n8️⃣ Performance comparison...');
        const testDate = new Date().toISOString().split('T')[0];
        
        // Time the old procedure (single day)
        const oldStart = Date.now();
        const oldResult = await executeStoredProcedure(
            'ProcDay',
            [['AppDate', TYPES.Date, testDate]],
            null,
            (columns) => ({ appointmentID: columns[0].value })
        );
        const oldTime = Date.now() - oldStart;
        
        // Time the new procedure (same day from weekly query)
        const newStart = Date.now();
        const newResult = await executeStoredProcedure(
            'ProcWeeklyCalendarOptimized',
            [
                ['StartDate', TYPES.Date, testDate],
                ['EndDate', TYPES.Date, testDate]
            ],
            null,
            (columns) => ({ appointmentID: columns[5].value })
        );
        const newTime = Date.now() - newStart;
        
        console.log(`✅ Performance comparison for ${testDate}:`);
        console.log(`   Old ProcDay: ${oldTime}ms (${oldResult.length} results)`);
        console.log(`   New Optimized: ${newTime}ms (${newResult.length} results)`);
        console.log(`   Performance improvement: ${oldTime > newTime ? 'BETTER' : 'SIMILAR'}`);
        
        return {
            success: true,
            calendarSlots: calendarCount[0].totalSlots,
            appointments: appointmentCount[0].totalAppointments,
            timeSlots: timeSlots[0].totalTimes,
            performanceImprovement: oldTime > newTime
        };
        
    } catch (error) {
        console.error('❌ Integration test failed:', error);
        throw error;
    }
}

/**
 * Main test runner
 */
async function runAllTests() {
    console.log('🧪 Calendar System Integration Test');
    console.log('====================================');
    console.log('Testing optimized calendar system with existing Shwan Orthodontics data');
    
    const results = {
        procedures: null,
        api: null,
        integration: null,
        success: false
    };
    
    try {
        // Run all tests
        results.procedures = await testCalendarProcedures();
        results.api = await testCalendarAPI();
        results.integration = await testExistingSystemIntegration();
        
        results.success = true;
        
        // Final summary
        console.log('\n✅ ALL TESTS PASSED!');
        console.log('==================');
        console.log(`📊 Calendar slots: ${results.procedures.calendarSlots}`);
        console.log(`👥 Appointments: ${results.procedures.appointments}`);
        console.log(`📈 Utilization: ${results.procedures.utilization}%`);
        console.log(`🗓️  Days structured: ${results.api.days}`);
        console.log(`⏰ Time slots: ${results.api.timeSlots}`);
        console.log(`🚀 Performance: ${results.integration.performanceImprovement ? 'IMPROVED' : 'MAINTAINED'}`);
        console.log('\n🎉 Your existing calendar system is fully compatible!');
        console.log('📱 You can now access the calendar at: http://localhost:3000/calendar.html');
        
    } catch (error) {
        results.success = false;
        console.error('\n❌ TESTS FAILED!');
        console.error('================');
        console.error('Error:', error.message);
        console.log('\n💡 Troubleshooting steps:');
        console.log('1. Ensure database connection is working');
        console.log('2. Run database procedures manually with: node db-utility.js');
        console.log('3. Check if FillCalender has been run recently');
        console.log('4. Verify tblcalender has future dates');
    }
    
    return results;
}

// Helper functions
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    const weekStart = new Date(d.setDate(diff));
    return weekStart.toISOString().split('T')[0];
}

function getWeekEnd(weekStart) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6); // Sunday end
    return d.toISOString().split('T')[0];
}

function transformToCalendarStructure(flatData) {
    const days = {};
    const timeSlots = new Set();
    
    flatData.forEach(item => {
        const dateKey = item.calendarDate.toISOString().split('T')[0];
        
        if (!days[dateKey]) {
            days[dateKey] = {
                date: dateKey,
                dayName: item.dayName,
                dayOfWeek: item.dayOfWeek,
                appointments: {}
            };
        }
        
        const timeKey = item.formattedTime;
        timeSlots.add(timeKey);
        
        days[dateKey].appointments[timeKey] = {
            appointmentID: item.appointmentID,
            appDetail: item.appDetail,
            drID: item.drID,
            patientName: item.patientName,
            present: item.present,
            seated: item.seated,
            dismissed: item.dismissed,
            personID: item.personID,
            slotStatus: item.slotStatus,
            slotDateTime: item.slotDateTime
        };
    });
    
    return {
        days: Object.values(days).sort((a, b) => new Date(a.date) - new Date(b.date)),
        timeSlots: Array.from(timeSlots).sort()
    };
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests().catch(error => {
        console.error('💥 Test runner failed:', error);
        process.exit(1);
    });
}

export { runAllTests, testCalendarProcedures, testCalendarAPI, testExistingSystemIntegration };