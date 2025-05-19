const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get("code");

window.onload = function () {
  fetch(window.location.origin + "/api/getpayments?code=" + code)
    .then((response) => response.json())
    .then((payments) => {
      tablepayments(payments);
     
    });
};
function tablepayments(payments) {
    const table = document.querySelector("table")
    for (const [i,payment] of payments.entries()){
       const row =  table.insertRow();
       const cell1 = row.insertCell();
      const cell2 =  row.insertCell();
      const cell3 = row.insertCell();
      cell1.innerHTML = i + 1
      cell2.innerHTML = formatDate(payment.Date);
      cell3.innerHTML = payment.Payment.toLocaleString("en-US");
    }
}
function formatDate(date) {
  var d = new Date(date),
      month = '' + (d.getMonth() + 1),
      day = '' + d.getDate(),
      year = d.getFullYear();

  if (month.length < 2) 
      month = '0' + month;
  if (day.length < 2) 
      day = '0' + day;

  return [day, month,year].join('-');
}
