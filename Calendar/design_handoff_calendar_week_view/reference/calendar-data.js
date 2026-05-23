/* Shared appointment data for all calendar variations.
   Week of Saturday May 16 — Thursday May 21, 2026.
   Friday (May 22) is the weekend/off-day. */

window.CAL_DATA = (function () {
  // Working hours: 14:00 – 20:30 in 30-minute slots
  const TIME_SLOTS = [
    '14:00', '14:30', '15:00', '15:30',
    '16:00', '16:30', '17:00', '17:30',
    '18:00', '18:30', '19:00', '19:30',
    '20:00', '20:30'
  ];

  // Procedure types  (LTR / English-side text)
  const PROC = {
    CHECK:   'Check-up',
    BOND:    'Bonding',
    WIRE:    'Wire change',
    ADJ:     'Adjustment',
    CONS:    'Consultation',
    REC:     'Records',
    EXT:     'Extraction',
    RET:     'Retainer fit',
    CLN:     'Cleaning',
    DEB:     'Debonding',
    EMG:     'Emergency',
    SEP:     'Separator',
    XRAY:    'X-ray review',
  };

  // Patient names — Arabic (RTL).  Anonymised, realistic for Kurdistan/Iraq.
  const N = {
    n1:  'محمد أحمد',
    n2:  'سارة علي حسن',
    n3:  'عمر صالح',
    n4:  'ليلى محمود',
    n5:  'أحمد كريم',
    n6:  'نور إبراهيم',
    n7:  'زينب جلال',
    n8:  'خالد سامي',
    n9:  'مريم فؤاد',
    n10: 'يوسف عبدالله',
    n11: 'دلشاد رزكار',
    n12: 'هيوا برزان',
    n13: 'ريناس آزاد',
    n14: 'شيلان نجم',
    n15: 'كاوە سرتيپ',
    n16: 'بەناز هۆشيار',
    n17: 'فاطمة عمر',
    n18: 'رەوەند هیوا',
    n19: 'علي حسين',
    n20: 'تارا دلشاد',
    n21: 'هاوار شیرکۆ',
    n22: 'سلمى رشيد',
    n23: 'إسراء طالب',
    n24: 'كاميار جوتيار',
    n25: 'بريوان سامان',
    n26: 'دانیار هیمن',
    n27: 'لانە كاوە',
  };

  // Days of the week (Sat first).  dayName matches Calendar.tsx convention.
  // Holiday = May 19 (Tuesday) – "Martyrs' Day" – realistic regional placeholder.
  const days = [
    {
      date: '2026-05-16', dayName: 'Saturday', dayOfWeek: 6, isHoliday: false,
      appts: {
        '14:00': [{ n: N.n1,  p: PROC.CHECK }],
        '14:30': [{ n: N.n2,  p: PROC.BOND }],
        '15:00': [{ n: N.n3,  p: PROC.WIRE }, { n: N.n4, p: PROC.ADJ }],
        '15:30': [{ n: N.n5,  p: PROC.CONS }],
        '16:00': [{ n: N.n6,  p: PROC.REC }],
        // STRESS — 5 appointments
        '17:00': [
          { n: N.n7,  p: PROC.ADJ },
          { n: N.n8,  p: PROC.WIRE },
          { n: N.n9,  p: PROC.CHECK },
          { n: N.n10, p: PROC.SEP },
          { n: N.n14, p: PROC.RET },
        ],
        '17:30': [{ n: N.n10, p: PROC.CLN }],
        '18:00': [{ n: N.n11, p: PROC.BOND }],
        '19:00': [{ n: N.n12, p: PROC.RET }],
        '19:30': [{ n: N.n13, p: PROC.ADJ }],
      },
    },
    {
      date: '2026-05-17', dayName: 'Sunday', dayOfWeek: 0, isHoliday: false, isToday: false,
      appts: {
        '14:30': [{ n: N.n14, p: PROC.WIRE }],
        '15:00': [{ n: N.n15, p: PROC.CHECK }],
        '15:30': [{ n: N.n16, p: PROC.BOND }],
        '16:00': [{ n: N.n17, p: PROC.ADJ }],
        '16:30': [{ n: N.n18, p: PROC.WIRE }, { n: N.n19, p: PROC.SEP }],
        '17:00': [{ n: N.n20, p: PROC.CONS }],
        '17:30': [{ n: N.n21, p: PROC.REC }],
        '18:00': [{ n: N.n22, p: PROC.RET }],
        '18:30': [{ n: N.n23, p: PROC.CHECK }],
        '19:00': [{ n: N.n24, p: PROC.ADJ }, { n: N.n25, p: PROC.WIRE }],
        '19:30': [{ n: N.n26, p: PROC.BOND }],
        '20:00': [{ n: N.n27, p: PROC.DEB }],
      },
    },
    {
      // Today
      date: '2026-05-18', dayName: 'Monday', dayOfWeek: 1, isHoliday: false, isToday: true,
      appts: {
        '14:00': [{ n: N.n3,  p: PROC.ADJ }],
        '14:30': [{ n: N.n7,  p: PROC.CHECK }, { n: N.n8, p: PROC.WIRE }],
        '15:00': [{ n: N.n11, p: PROC.BOND }],
        '15:30': [{ n: N.n14, p: PROC.WIRE }],
        // STRESS — 4 appointments (today)
        '16:00': [
          { n: N.n16, p: PROC.RET },
          { n: N.n17, p: PROC.CONS },
          { n: N.n19, p: PROC.SEP },
          { n: N.n21, p: PROC.WIRE },
        ],
        '16:30': [{ n: N.n22, p: PROC.CHECK }],
        '17:00': [{ n: N.n1,  p: PROC.WIRE }],
        '17:30': [{ n: N.n2,  p: PROC.ADJ }],
        '18:00': [{ n: N.n5,  p: PROC.BOND }, { n: N.n6, p: PROC.CHECK }],
        '18:30': [{ n: N.n9,  p: PROC.CLN }],
        '19:00': [{ n: N.n13, p: PROC.WIRE }],
        '19:30': [{ n: N.n20, p: PROC.RET }],
        '20:00': [{ n: N.n24, p: PROC.ADJ }],
      },
    },
    {
      // Holiday — full-column blocked
      date: '2026-05-19', dayName: 'Tuesday', dayOfWeek: 2, isHoliday: true,
      holidayName: 'Anfal Memorial Day',
      appts: {},
    },
    {
      date: '2026-05-20', dayName: 'Wednesday', dayOfWeek: 3, isHoliday: false,
      appts: {
        '14:00': [{ n: N.n4,  p: PROC.CHECK }],
        '14:30': [{ n: N.n10, p: PROC.BOND }],
        '15:00': [{ n: N.n12, p: PROC.WIRE }, { n: N.n15, p: PROC.ADJ }],
        '15:30': [{ n: N.n18, p: PROC.WIRE }],
        '16:00': [{ n: N.n21, p: PROC.CONS }],
        '16:30': [{ n: N.n25, p: PROC.RET }],
        '17:30': [{ n: N.n27, p: PROC.EMG }],
        '18:00': [{ n: N.n3,  p: PROC.CHECK }, { n: N.n4, p: PROC.WIRE }],
        '18:30': [{ n: N.n6,  p: PROC.BOND }],
        '19:00': [{ n: N.n8,  p: PROC.ADJ }],
        '19:30': [{ n: N.n11, p: PROC.CLN }],
      },
    },
    {
      date: '2026-05-21', dayName: 'Thursday', dayOfWeek: 4, isHoliday: false,
      appts: {
        '14:00': [{ n: N.n13, p: PROC.WIRE }],
        '14:30': [{ n: N.n14, p: PROC.CHECK }, { n: N.n15, p: PROC.ADJ }],
        '15:30': [{ n: N.n17, p: PROC.BOND }],
        '16:00': [{ n: N.n19, p: PROC.RET }],
        '16:30': [{ n: N.n20, p: PROC.ADJ }],
        '17:00': [{ n: N.n23, p: PROC.WIRE }, { n: N.n24, p: PROC.CHECK }, { n: N.n25, p: PROC.CONS }, { n: N.n26, p: PROC.EXT }],
        '17:30': [{ n: N.n26, p: PROC.BOND }],
        '18:00': [{ n: N.n1,  p: PROC.ADJ }],
        '18:30': [{ n: N.n7,  p: PROC.WIRE }],
        '19:30': [{ n: N.n2,  p: PROC.RET }],
      },
    },
  ];

  function countAppts(day) {
    return Object.values(day.appts).reduce((acc, arr) => acc + arr.length, 0);
  }

  // bookedSlots = time-slots that have ≥1 appointment (matches production
  // stats API semantics — see routes/calendar.ts).  Multi-appointment slots
  // still count as one booked slot.
  function totals() {
    let bookedSlots = 0;
    let totalAppointments = 0;
    days.forEach(d => {
      if (d.isHoliday) return;
      Object.values(d.appts).forEach(arr => {
        if (arr && arr.length > 0) {
          bookedSlots += 1;
          totalAppointments += arr.length;
        }
      });
    });
    const workingDays = days.filter(d => !d.isHoliday).length;
    const totalSlots = TIME_SLOTS.length * workingDays;
    const available = totalSlots - bookedSlots;
    const utilization = Math.round((bookedSlots / totalSlots) * 100);
    return { booked: bookedSlots, available, totalSlots, utilization, appointments: totalAppointments };
  }

  return { TIME_SLOTS, days, totals, PROC };
})();
