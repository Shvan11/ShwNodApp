/* Stress-test data for slot density studies.
   One day column.  Mix of empty / 1 / 2 / 3 / 4 / 5 appointments per slot. */
window.DENSITY_DATA = (function () {
  const TIME_SLOTS = [
    '14:00', '14:30', '15:00', '15:30',
    '16:00', '16:30', '17:00', '17:30',
    '18:00', '18:30', '19:00', '19:30',
    '20:00', '20:30',
  ];

  // Each entry mirrors CAL_DATA shape: { n: name (RTL), p: procedure }
  const stress = {
    '14:00': [
      { n: 'محمد أحمد', p: 'Check-up' },
    ],
    '14:30': [],
    '15:00': [
      { n: 'سارة علي حسن',  p: 'Wire change' },
      { n: 'عمر صالح',        p: 'Adjustment' },
    ],
    '15:30': [
      { n: 'ليلى محمود', p: 'Bonding' },
    ],
    '16:00': [
      { n: 'أحمد كريم',  p: 'Records' },
      { n: 'نور إبراهيم', p: 'Wire change' },
      { n: 'زينب جلال',   p: 'Check-up' },
    ],
    '16:30': [],
    '17:00': [
      // STRESS — 5 appointments
      { n: 'خالد سامي',     p: 'Wire change' },
      { n: 'مريم فؤاد',     p: 'Adjustment' },
      { n: 'يوسف عبدالله',  p: 'Records' },
      { n: 'دلشاد رزكار',  p: 'Separator' },
      { n: 'هيوا برزان',    p: 'Wire change' },
    ],
    '17:30': [
      { n: 'ريناس آزاد', p: 'Bonding' },
    ],
    '18:00': [
      { n: 'شيلان نجم',     p: 'Cleaning' },
      { n: 'كاوە سرتيپ',    p: 'Adjustment' },
    ],
    '18:30': [
      // 4 appointments
      { n: 'بەناز هۆشيار', p: 'Retainer fit' },
      { n: 'فاطمة عمر',    p: 'Check-up' },
      { n: 'رەوەند هیوا',  p: 'Wire change' },
      { n: 'علي حسين',     p: 'Adjustment' },
    ],
    '19:00': [],
    '19:30': [
      { n: 'تارا دلشاد', p: 'Bonding' },
    ],
    '20:00': [
      { n: 'هاوار شیرکۆ', p: 'Debonding' },
    ],
    '20:30': [],
  };

  return { TIME_SLOTS, stress };
})();
