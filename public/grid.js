const urlParams = new URLSearchParams(window.location.search);
const code = urlParams.get("code");
const tp = urlParams.get("tp") || 0;
import { gettimepoints } from "./module.js"; //import gettimepoints from "./module.js";

window.onload = function () {

  fetch(window.location.origin + "/api/getgal?code=" + code + "&tp=" + tp)
    .then((response) => response.json())
    .then((imags) => {
      SetImgs(imags);
    });

    gettimepoints(code, tp);
 
};



function SetImgs(imags) {
  const imgtags = [
    document.querySelector("#apf"),
    document.querySelector("#afr"),
    document.querySelector("#afs"),
    document.querySelector("#aup"),
    document.querySelector("#alogo"),
    document.querySelector("#alw"),
    document.querySelector("#art"),
    document.querySelector("#act"),
    document.querySelector("#alf"),
  ];

  for (let i = 0; i < imgtags.length; i++) {
    if (imags[i]) {
      let imglink = 'DolImgs/' + imags[i].name;
      imgtags[i].href = imglink
      imgtags[i].setAttribute("data-pswp-width", imags[i].width);
      imgtags[i].setAttribute("data-pswp-height", imags[i].height);
      imgtags[i].firstChild.src = imglink
    }
    else if (i < 3) { imgtags[i].firstChild.src = "No_img_f.png" }
    else if (i < 6) { imgtags[i].firstChild.src = "No_img_o.png" }
    else { imgtags[i].firstChild.src = "No_img_r.png" }
  }
}

