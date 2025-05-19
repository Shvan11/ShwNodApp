export default class Images extends EventTarget {
  constructor() {
    super();
    this.factor1 = 6;
    this.factor2 = 6;
    this.orient = "v";
    this.ImgV1 = 0;
    this.ImgH1 = 0;
    this.ImgH2 = 0;
    this.ImgV2 = 0;
    this.images = [];
    this.logo_v = 0;
    this.logo_h = 0;
    this.logof = 3;
    this.rotated1 = false;
    this.rotated2 = false;
    this.canvas = document.getElementById("canvas");
    this.context = canvas.getContext("2d");
    this.selected = 1;
    this.auto = true;
    this.border = 10;
    this.canvas1 = document.createElement("canvas");
    this.canvas2 = document.createElement("canvas");
    this.context1 = this.canvas1.getContext("2d");
    this.context2 = this.canvas2.getContext("2d");
    this.context.fillStyle = "black";
    this.context1.fillStyle = "black";
    this.context2.fillStyle = "black";
    this.cw1 = 0;
    this.cw2 = 0;
    this.clp1 = 0;
    this.clp2 = 0;
    this.pathDrawn = false;
  }
  /**
   * @param {string[]} urls
   */

  loadImages = async function () {
    async function loadImage(url) {
      return new Promise((fulfill) => {
        let imageObj = new Image();
        imageObj.src = url;
        imageObj.crossOrigin = "anonymous";
        imageObj.onload = () => fulfill(imageObj);
      });
    }
    const promises = [];
    for (let i = 0; i < this.urls.length; i++) {
      promises.push(await loadImage(this.urls[i]));
    }
    await Promise.all(promises).then((myimages) => {
      this.images = myimages;
      this.dispatchEvent(new Event("loaded"));
      return;
    });
  };

  async DrawImages() {
    if (this.auto) {
      this.DrawAuto();
    } else {
      await this.drawOne(0);
      await this.drawOne(1);
      this.redrawCanvas();
    }
    const buttons = document.querySelectorAll(".PButton");
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }

  async DrawAuto() {
    const b = this.border;
    
    const updateRes = () => {
      const select = document.querySelector('#c_s');
      const newOpt = document.createElement('option')
      newOpt.innerHTML = "Auto (" + this.canvas.width + " * " + this.canvas.height + ")"
      newOpt.value = "auto"
      select.remove(0)
      select.add(newOpt,0); 
      select.selectedIndex = 0;
      }
    if (this.orient == "v") {


      //sizing
      const width = this.images[0].width / this.factor1;
      const height1 = this.images[0].height / this.factor1;
      const height2 = this.images[1].height * (width / this.images[1].width);
      //conditional operator ?
      this.canvas.width = width + 2 * b;
      this.canvas.height = height1 + height2 + 4 * b;
      this.canvas1.width = width + 2 * b;
      this.canvas1.height = height1 + 2 * b;
      this.canvas2.width = width + 2 * b;
      this.canvas2.height = height2 + 2 * b;
      this.factor2 = this.images[1].width / width;
      updateRes();
      this.drawOne(0);
      this.drawOne(1);
      this.drawLogo();
    } else if (this.orient == "h") {
      //orientation is horizontal and auto
       //sizing
       const height = this.images[0].height / this.factor1
      const width1 = this.images[0].width / this.factor1;
      const width2 =
      this.images[1].width * height/this.images[1].height;
      this.factor2 = this.images[1].width/width2
      this.canvas.width= width1 + width2 + 4 * b;
      this.canvas.height= height + 2 * b;
      this.canvas1.width=width1 + 2 * b;
      this.canvas1.height=height + 2 * b;
      this.canvas2.width=width2 + 2 * b ;
      this.canvas2.height=height + 2 * b;
      updateRes();
      this.drawOne(0);
      this.drawOne(1);
      this.drawLogo();
      ;
    } else {
      await this.drawOne(0);
      await this.drawOne(1);
    }

  
    // document.getElementById("myimg").src = canvas.toDataURL("image/png");
    const buttons = document.querySelectorAll(".PButton");
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }

  async drawOne(no) {
    const f = this["factor" + (no + 1)];
    const h_O = this["ImgH" + (no + 1)];
    const v_O = this["ImgV" + (no + 1)];
    const b = this.border;
    const canvases = [this.canvas1, this.canvas2];
    const contexts = [this.context1, this.context2];
    let images = this.images;

    contexts[no].clearRect(0, 0, canvases[no].width, canvases[no].height);
    contexts[no].fillRect(0, 0, canvases[no].width, canvases[no].height);

    const width = images[no].width / f;
    const height = images[no].height / f;
    const width_d = canvases[no].width - 2 * b - width;
    const height_d = canvases[no].height - 2 * b - height;

    contexts[no].save();
    contexts[no].beginPath();
    contexts[no].rect(
      this["clp" + (no + 1)],
      this["clp" + (no + 1)],
      canvases[no].width - 2 * this["clp" + (no + 1)],
      canvases[no].height - 2 * this["clp" + (no + 1)]
    );
    contexts[no].clip();
    //rotate canvas
    if (this["rotated" + (no + 1)] == true || this["cw" + (no + 1)] != 0) {
      contexts[no].translate(canvases[no].width / 2, canvases[no].height / 2);
      contexts[no].rotate((this["cw" + (no + 1)] * Math.PI) / 180);
      contexts[no].translate(-canvases[no].width / 2, -canvases[no].height / 2);
    }
    
    if (width_d >= 0 && height_d >= 0) {
      contexts[no].drawImage(
        images[no],
        width_d / 2 + h_O,
        height_d / 2 + v_O,
        width,
        height
      );

      console.log("cond1");
    } else if (width_d >= 0 && height_d < 0) {
      let aheight_d = Math.abs(height_d);
      contexts[no].drawImage(
        images[no],
        0,
        (aheight_d / 2) * f - v_O,
        width * f,
        (height - aheight_d) * f,
        b + h_O + width_d / 2,
        b,
        width,
        canvases[no].height - 2 * b
      );
      console.log("cond2");
    } else if (width_d < 0 && height_d < 0) {
      let awidth_d = Math.abs(width_d);
      let aheight_d = Math.abs(height_d);
      contexts[no].drawImage(
        images[no],
        (awidth_d / 2) * f - h_O,
        (aheight_d / 2) * f - v_O,
        (width - awidth_d) * f,
        (height - aheight_d) * f,
        b,
        b,
        canvases[no].width - 2 * b,
        canvases[no].height - 2 * b
      );
      console.log("cond3");
    } else if (width_d < 0 && height_d >= 0) {
      let awidth_d = Math.abs(width_d);
      contexts[no].drawImage(
        images[no],
        (awidth_d / 2) * f - h_O,
        0,
        (width - awidth_d) * f,
        height * f,
        b,
        b + v_O + height_d / 2,
        canvases[no].width - 2 * b,
        height
      );
      console.log("cond4");
    }

    //de-rotate canvas and clip
    contexts[no].restore();
    if (this["rotated" + (no + 1)] == true || this["cw" + (no + 1)] != 0) {
      if (this["cw" + (no + 1)] == 0) {
        this["rotated" + (no + 1)] = false;
      }
    }

   
    const buttons = document.querySelectorAll(".PButton");
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }

  canvas_size(val) {
   
    if(val == "auto"){
      this.auto = true;
      if (this.images.length != 0){
        this.DrawAuto();
      }
      return;
    }
    this.auto=false
    this.canvas.width = JSON.parse(val).width;
    this.canvas1.width = JSON.parse(val).width;
    this.canvas2.width = JSON.parse(val).width;
    this.canvas.height = JSON.parse(
      val
    ).height;
    this.canvas1.height =
      JSON.parse(val).height / 2;
    this.canvas2.height =
      JSON.parse(val).height / 2;
      if (this.canvas.height>1350){
        console.log(this.canvas.height)
       this.factor1 -=1
        this.factor2 -= 1
      }
if  (this.images.length != 0){
    this.drawOne(0);
    this.drawOne(1);
    this.redrawCanvas();
}
  }

  drawLogo() {
    let logoWidth = this.images[2].width / this.logof;
    let logoHeight = (this.images[2].height * logoWidth) / this.images[2].width;
  
    let logo_h = this.canvas.width / 2 - logoWidth / 2 + this.logo_h;
    let logo_v = this.canvas.height / 2 - logoHeight /1.3 + this.logo_v;
    this.redrawCanvasNoLogo();
    this.context.drawImage(
      this.images[2],
      logo_h,
      logo_v,
      logoWidth,
      logoHeight
    );
  }

  redrawCanvasNoLogo() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.orient == "v"){
    this.context.drawImage(this.canvas1, 0, 0);
    this.context.drawImage(this.canvas2, 0, this.canvas.height / 2);
    }
    else{
      this.context.drawImage(this.canvas1, 0, 0);
      this.context.drawImage(this.canvas2,  this.canvas.width / 2,0);
    }
  }

  redrawCanvas() {
    this.drawLogo();
  }

  async change(i) {
    this.selected = i;
  }

  async Auto(i) {
    this.auto = i;
    if (this.auto) {
      if (this.images.length != 0){
      this.DrawAuto();
    } }
    else {
      this.canvas_size();
    }
  }
  
  async clockwise(degrees) {
    this["cw" + this.selected] += degrees;
    await this.drawOne(this.selected - 1);
    this["rotated" + this.selected] = true;
    this.redrawCanvas();
  }
  async cclockwise(degrees) {
    this["cw" + this.selected] -= degrees;
    await this.drawOne(this.selected - 1);

    this["rotated" + this.selected] = true;
    this.redrawCanvas();
  }

  async IncreaseClp() {
    this["clp" + this.selected] += 10;
    await this.drawOne(this.selected - 1);
    this.redrawCanvas();
  }

  async DecreaseClp() {
    this["clp" + this.selected] -= 10;
    await this.drawOne(this.selected - 1);
    this.redrawCanvas();
  }

  async bisect() {
    if (this.pathDrawn) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.pathDrawn = false;
      await this.drawOne(0);
      await this.drawOne(1);
      this.redrawCanvas();
      return;
    }
    this.context.beginPath();
    this.context.moveTo(this.canvas.width / 2, 0);
    this.context.lineTo(this.canvas.width / 2, this.canvas.height);
    this.context.stroke();
    this.pathDrawn = true;
  }

  
  changeOrient = async function () {
    if (this.orient === "v") {
      this.orient = "h";
    } else {
      this.orient = "v";
    }
    await this.DrawImages();
  };

  async zoom() {
    if (this.selected == 3) {
      this.logof -= 0.1;
      this.drawLogo();
      return;
    }
    this["factor" + this.selected] -= 0.1;
    await this.drawOne(this.selected - 1);
    this.redrawCanvas();
  }

  async zoomOut() {
    if (this.selected == 3) {
      this.logof += 0.1;
      this.drawLogo();
      return;
    }
    this["factor" + this.selected] += 0.1;
    await this.drawOne(this.selected - 1);
    this.redrawCanvas();
  }

  async MoveR() {
    if (this.selected == 3) {
      this.logo_h += 5;
      this.drawLogo();
      return;
    }
    this["ImgH" + this.selected] += 10;
    await this.drawOne(this.selected - 1);
    this.redrawCanvas();
  }

  async MoveL() {
    if (this.selected == 3) {
      this.logo_h -= 5;
      this.drawLogo();
      return;
    }
    this["ImgH" + this.selected] -= 10;
    await this.drawOne(this.selected - 1);
    this.redrawCanvas();
  }
  async MoveU() {
    if (this.selected == 3) {
      this.logo_v -= 5;
      this.drawLogo();
      return;
    }

    this["ImgV" + this.selected] -= 10;
    await this.drawOne(this.selected - 1);
    this.redrawCanvas();
  }

  async removeL(){
    this.redrawCanvasNoLogo();
  }
  async MoveD() {
    if (this.selected == 3) {
      this.logo_v += 5;
      this.drawLogo();
      return;
    }
    this["ImgV" + this.selected] += 10;
    await this.drawOne(this.selected - 1);
    this.redrawCanvas();
  }
  reset() {
    this.factor1 = 6;
    this.factor2 = 6;
    this.orient = "v";
    this.ImgV1 = 0;
    this.ImgH1 = 0;
    this.ImgH2 = 0;
    this.ImgV2 = 0;
    this.cw1 = 0;
    this.cw2 = 0;
    this.clp1 = 0;
    this.clp2 = 0;
    // this.drawOne(0);
    // this.drawOne(1);
    this.redrawCanvas();
  }
}
