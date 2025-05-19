
import PhotoSwipeLightbox from '/photoswipe/dist/photoswipe-lightbox.esm.js';
const options = {
  gallery: '#dolph_gallery',
  children: 'a',
  pswpModule: () => import('/photoswipe/dist/photoswipe.esm.js')
};
const lightbox = new PhotoSwipeLightbox(options);
lightbox.on('uiRegister', function() {
  lightbox.pswp.ui.registerElement({
    name: 'download-button',
    order: 8,
    isButton: true,
    tagName: 'a',

    // SVG with outline
    html: {
      isCustomSVG: true,
      inner: '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
      outlineID: 'pswp__icn-download'
    },

    // Or provide full svg:
    // html: '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" class="pswp__icn"><path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" /></svg>',

    // Or provide any other markup:
    // html: '<i class="fa-solid fa-download"></i>' 
   
    onInit: (el, pswp) => {
     // el.setAttribute('download', '');
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
      el.setAttribute('download', '');
      pswp.on('change', () => {
        console.log('change');
        const dLink = pswp.currSlide.data.src
        const fileName = dLink.substring(dLink.lastIndexOf('/')+1);
        const extention = fileName.slice(-3);
        let mFileName;
        switch (extention) {
case "i10" :
mFileName ="Profile" + ".jpg"
break;
case "i12" :
mFileName ="Rest" + ".jpg"
break;
case "i13" :
mFileName ="Smile" + ".jpg"
break;
case "i23" :
mFileName ="Upper" + ".jpg"
break;
case "i24" :
mFileName ="Lower" + ".jpg"
break;
case "i20" :
mFileName ="Right" + ".jpg"
break;
case "i22" :
mFileName ="Center" + ".jpg"
break;
case "i21" :
mFileName ="Left" + ".jpg"
break;
        }
        el.setAttribute('download', mFileName);
       el.href = pswp.currSlide.data.src;
      });
    }
  });
});
lightbox.init();
