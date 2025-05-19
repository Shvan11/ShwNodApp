
const urlParams = new URLSearchParams(window.location.search);
const filePath = urlParams.get("file");
const path = decodeURI(filePath);
const paths_array = path.split(',');

const bar = {
    filledBar: document.getElementById("filledBar"),
    emptyBar:  document.getElementById("emptyBar"),
    width:  function() {this.filledBar.style.width},
    set width(width) {
      filledBar.style.width = width;
    },
    text: function() {this.filledBar.text},
    set text(text) {
      filledBar.innerHTML = text;
    },
    set fbDisplay(display) {
       this.filledBar.style.display = display;
    },
    set ebDisplay(display) {
      this.emptyBar.style.display = display;
    },
    bInterval: 200,
    absWidth: 0,
    initiate: function () {
        console.log("initiate");
      this.width = "0%";
      this.text = "Sending...";
      this.fbDisplay = "block";
      this.ebDisplay = "block";
      this.absWidth = 1;
      this.bTimer = 0;
      this.startBar();
    },
    startBar: function () {
        console.log("startBar");
      this.bTimer = setInterval(() => this.progress(), this.bInterval);
    },
    progress: function () {
      if (this.absWidth >= 90) {
        clearInterval(this.bTimer);
      } else {
        this.absWidth++;
        this.width = this.absWidth + "%";
      }
    },
    finish: function () {
      clearInterval(this.bTimer);
      this.width = "100%";
      this.text = "Done!";
    },
    reset: function () {
      clearInterval(this.bTimer);
      this.fbDisplay = "none";
      this.ebDisplay = "none";
      this.width = "0%";
      this.text = "";
    },
  };

document.getElementById("file").value = path;
window.onload = function () {

    const form = document.getElementById("abc");
    form.style.display = "block";
    document.getElementById("popform").onsubmit = handleSubmit;
}

function handleSubmit(event) {
    event.preventDefault(); 
    bar.initiate();
    var phone = document.getElementById("phone").value;
    var prog = document.getElementById("prog").value;
    var formData = new FormData();
    formData.append("prog", prog);
    formData.append("phone", phone);
    formData.append("file", document.getElementById("file").value);

    fetch(window.location.origin + "/sendmedia2", {
        method: "POST",
        body: formData
    })
        .then(response => {return response.json() })
        .then(data => {
            if (data.qr) {
                const img = document.createElement("img");
                img.setAttribute('id', 'qr_img');
                img.src = data.qr;
                document.body.appendChild(img);
                document.getElementById("abc").style.display = "none";
                updateQr();
            }
            else if (data.result == "OK") {
                bar.finish();
                // alert(`${data.sentMessages} message sent successfully`)
            }
        })
}


async function updateQr() {
    const response = await fetch(window.location.origin + "/checkqr");
    const data = await response.json();
    if (data.qr) {
        const img = document.getElementById("qr_img");
        img.src = data.qr;
       updateQr();
    }
    else if (data.status == "success") {
        alert("Authorized successfully");
        document.getElementById("abc").style.display = "block";
        document.getElementById("qr_img").remove();
    }
}

async function fetchContacts(source) {
    if (source == "pat") {
        return fetch('/patientsPhones')
            .then((response) => response.json());
    } else {
        return fetch('/google?source=' + source)
            .then((response) => response.json());
    }
}

$(document).ready(async function () {
    let source = document.getElementById("source").value;
    let data = await fetchContacts(source);

    $('#people').select2(
        {
            data: data,
            templateResult: formatOption,
            templateSelection: formatOption
        }
    );

    $('#source').on('change', async function () {
        const selectedSource = $(this).val();

        // Example: Simulate fetching new data based on the selected value
        const newData = await fetchContacts(selectedSource);

        // Clear and update the "people" Select2 dropdown with new data
        $('#people').empty().select2({
            data: newData,
            templateResult: formatOption,
            templateSelection: formatOption
        });
    });


    $('#people').on('select2:select', function (e) {
        const phone_no = e.params.data.phone;
        const selectedSource = document.getElementById("source").value;
        if (selectedSource == "pat") {
            document.getElementById("phone").value = "964" + phone_no;
            return;
        }
        const match = phone_no.match(/(?:(?:(?:00)|\+)(?:964)|0)[ ]?(\d{3})[ ]?(\d{3})[ ]?(\d{4})/);
        if (match) {
            document.getElementById("phone").value = "964" + match[1] + match[2] + match[3]; // Return the 10 digits
        } else {
            // If the number doesn't match the expected formats, return original number
            document.getElementById("phone").value = phone_no;
        }
    })
})


function formatOption(option) {
    return $(
        `<div class="two-column-option">
        <div class="column">${option.name}</div>
        <div class="column">${option.phone}</div>
      </div>`
    );
}
