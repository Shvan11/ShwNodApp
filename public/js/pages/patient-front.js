const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get("code");
var phone;
var timer;
document.getElementById("invisible").addEventListener("load",check_res)
window.onload = function () {
  document.querySelector(".plink").href = "Payments.html?code=" + code;

  document.querySelector(".photo").src = "DolImgs/" + code + "00.I13";

  fetch(window.location.origin + "/api/getinfos?code=" + code)
    .then((response) => response.json())
    .then((infos) => {
      fillinfos(infos);
    });

  fetch(window.location.origin + "/api/gettimepoints?code=" + code)
    .then((response) => response.json())
    .then((timepoints) => {
      filltimepoints(timepoints);
    });
};

function fillinfos(infos) {
  if (typeof infos.assets != "undefined") {
    const assetslist = document.querySelector(".assets");
    for (const asset of infos.assets) {
      const assetitem = document.createElement("li");
      const alink = document.createElement("a");
      alink.textContent = asset;
      alink.setAttribute(
        "href",
        "assets/" + code + "/assets/" + encodeURIComponent(asset)
      );
      assetitem.appendChild(alink);
      assetslist.appendChild(assetitem);
    }
  }

  if (typeof infos.xrays != "undefined") {
    const xrayslist = document.querySelector(".xrays");
    for (const xray of infos.xrays) {
  
      if (xray.name == "PatientInfo.xml") {
        continue;
      }
      const xrayitem = document.createElement("li");
      xrayitem.setAttribute("class", "x_item");
      const gbutton = document.createElement("button");
      gbutton.addEventListener("click", function () {
        div_show(xray);
      });
      //const xp = document.createElement("p");

      const xlink = document.createElement("a");
      //xlink.innerHTML = xray.name;
      gbutton.textContent = "Send";
      xlink.setAttribute(
        "href",
        "getxray/" + "?code=" + code + "&file=" + xray.name + "&imageF=" + xray.imageF
      );
      //xp.appendChild(xlink);
      //xp.innerHTML = xp.innerHTML + "&nbsp;";
      //create text element
      const dateElement = document.createElement("p");
      // Add any necessary properties or attributes to the text element
      dateElement.textContent = xray.date;
      //create a div element and put the image inside it
      const imageContainer  = document.createElement("div");
      // Add any necessary properties or attributes to the div
      imageContainer.setAttribute("class", "x_img_container");
      //create an image element 
      const img = document.createElement("img");
      img.src = "assets/" + code + "/OPG/.csi_data/.version_4.4/" + xray.imageF+ "/t.png"  ;
      img.setAttribute("class", "x_img");
      //append the image to the div
      imageContainer.appendChild(img);
      //xrayitem.appendChild(xp);
      //xrayitem.appendChild(imageContainer);
      xlink.appendChild(imageContainer);
      xrayitem.appendChild(xlink);
      xrayitem.appendChild(dateElement);
      xrayitem.appendChild(gbutton);
      xrayslist.appendChild(xrayitem);
     
    }
  }

  const ne = document.querySelector(".pname");
  ne.innerHTML += infos.name;
  const sd = document.querySelector(".sdate");
  sd.innerHTML += infos.startdate;
  phone = infos.phone;
}

function filltimepoints(timepoints) {
  if (typeof timepoints != "undefined") {
    const photoslist = document.querySelector(".photos");
    const tpForm = document.querySelector(".times");
    for (const tp of timepoints) {
      const tpitem = document.createElement("li");
      const alink = document.createElement("a");
      alink.textContent = tp.tpDescription;
      alink.setAttribute("href", "grid.html?code=" + code + "&tp=" + tp.tpCode);
      tpitem.appendChild(alink);
      photoslist.appendChild(tpitem);
    }
  }
}

function compare() {
  window.location.href =
    window.location.origin + "/canvas.html?code=" + code + "&phone=" + phone;
}


function sendtocanvas() {
  var category = "";
  var tp1;
  var tp2;
  const radios = document.querySelectorAll('[name="photos"]');
  for (i = 0; i < radios.length; i++) {
    if (radios[i].checked) {
      category = radios[i].value;
      break;
    }
  }
  const checks = document.querySelectorAll('[name="tpCheck"]');
 
  for (k = 0; k < checks.length; k++) {
    if (checks[k].checked) {
      if (!tp1) {
        tp1 = checks[k].value;
        continue;
      } else {
        tp2 = checks[k].value;
        break;
      }
    }
  }
  window.location.href =
    window.location.origin + "/canvas.html?code=" + code + "&phone=" + phone;
}


function check_empty() {
  document.getElementById("waform").submit();
  initiate_bar();
}
//}
//Function To Display Popup
function div_show(XXX) {
  document.getElementById("abc").style.display = "block";
  document.getElementById("file").value = XXX;
  document.getElementById("phone").value = phone;
  document.getElementById("code").value = code;
}
//Function to Hide Popup
function div_hide() {
  document.getElementById("abc").style.display = "none";

}


function check_res  () {
  const iframe = document.getElementById("invisible");
  if ((iframe.textContent = "OK")) {
    clearInterval(timer);
    div_hide();
  }
}

async function initiate_bar() {
  const elem = document.getElementById("filledBar");
  elem.style.width = "0%";
  const elem2 = document.getElementById("emptyBar");
  elem.innerHTML = "Sending...";
  elem.style.display = "block";
  elem2.style.display = "block";
  let width = 1;
  moveBar();

  function frame() {
    if (width >= 90) {
      clearInterval(timer);
    } else {
      width++;
      elem.style.width = width + "%";
    }
  }
  
  function moveBar() {
    timer = setInterval(frame, 100);
  }

  function completeBar() {
    clearInterval(timer);
    elem.style.width = "100%";
    elem.innerHTML = "Done!";
  }
}


