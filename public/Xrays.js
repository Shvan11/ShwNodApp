const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get("code");
import { gettimepoints } from "./module.js";
import * as wa from "./wa_module.js"
let phone;

window.onload = function () {
    fetch(window.location.origin + "/api/getinfos?code=" + code)
        .then((response) => response.json())
        .then((infos) => {
            fillXrays(infos);
            phone = infos.phone; // Store phone number if needed
        });
    gettimepoints(code, "xrays");
    wa.addDivToDocumentEnd();
};

function fillXrays(infos) {
    if (typeof infos.xrays != "undefined") {
        const xrayslist = document.querySelector(".xrays");
        for (const xray of infos.xrays) {
            if (xray.name == "PatientInfo.xml") {
                continue;
            }

            const xrayitem = document.createElement("li");
            xrayitem.setAttribute("class", "x_item");

            const xlink = document.createElement("a");
            //xlink.textContent = xray.name;
            xlink.setAttribute(
                "href",
                "getxray/" + "?code=" + code + "&file=" + xray.name + "&imageF=" + xray.imageFile
            );

            const dateElement = document.createElement("p");
            if (xray.date) {
                dateElement.textContent = xray.date;
            } else {
                dateElement.textContent = xray.name;
            }

            const imageContainer = document.createElement("div");
            imageContainer.setAttribute("class", "x_img_container");
            if (xray.previewImagePartialPath) {
                const img = document.createElement("img");
                img.src = "assets/" + code + xray.previewImagePartialPath;
                img.setAttribute("class", "x_img");
                imageContainer.appendChild(img);
                xlink.appendChild(imageContainer)
            } else {
                xlink.textContent = 'Click to view X-ray';
            }
            xrayitem.appendChild(xlink);
            xrayitem.appendChild(dateElement);

            const gbutton = document.createElement("button");
            gbutton.addEventListener("click", function () {
                wa.div_show(xray);
            });
            gbutton.textContent = "Send";
            xrayitem.appendChild(gbutton);

            xrayslist.appendChild(xrayitem);
        }
    }
}

