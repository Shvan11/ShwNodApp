
export function addDivToDocumentEnd(phone) {
    // Create the main container div
    const containerDiv = document.createElement('div');
    containerDiv.id = 'abc';
  
    // Create the popup div
    const popupDiv = document.createElement('div');
    popupDiv.id = 'popupContact';
  
    // Create the form
    const form = document.createElement('form');
    form.action = '/sendxray';
    form.id = 'popform';
    form.method = 'get';
    form.name = 'form';
    form.target = 'invisible';
    form.classList.add('waform'); 
  
    // Create the close image
    const closeImg = document.createElement('img');
    closeImg.id = 'waclose';
    closeImg.src = 'images/R.png';
    closeImg.onclick = div_hide; 
  
    // Create the heading
    const heading = document.createElement('h2');
    heading.textContent = 'Send WhatsUp';
  
    // Create the horizontal rule
    const hr = document.createElement('hr');
  
    // Create input elements
    const codeInput = createInput('code', 'hidden', 'Code');
    const phoneInput = createInput('phone', 'number', 'phone','waphone'); 
    const fileInput = createInput('file', 'text', 'File');
  
    // Create the submit anchor
    const submitLink = document.createElement('a');
    submitLink.href = 'javascript:%20check_empty()'; 
    submitLink.id = 'wasubmit';
    submitLink.textContent = 'Send';
  
   // Create progress bar elements
  const emptyBar = document.createElement('div');
  emptyBar.id = 'emptyBar';
  const filledBar = document.createElement('div');
  filledBar.id = 'filledBar';
  filledBar.textContent = 'Sending...';



  
    // Append elements to the form
    form.appendChild(closeImg);
    form.appendChild(heading);
    form.appendChild(hr);
    form.appendChild(codeInput);
    form.appendChild(phoneInput);
    form.appendChild(fileInput);
    form.appendChild(submitLink);
    // ... (Append the rest)
    // Append progress bars to form
    emptyBar.appendChild(filledBar);
    form.appendChild(emptyBar);
    // Append form to popup and popup to the main container
    popupDiv.appendChild(form);
    containerDiv.appendChild(popupDiv);
  
    // Append the container to the document body
    document.body.appendChild(containerDiv);
  }
  
  // Helper function to create input elements
  function createInput(name, type, placeholder,aclass) {
    const input = document.createElement('input');
    input.name = name;
    input.type = type;
    input.placeholder = placeholder;
    input.classList.add('wainput', aclass ?? 'null');
    return input;
  }


function check_empty() {
    document.getElementById("waform").submit();
    initiate_bar();
  }
  //}
  //Function To Display Popup
  export function div_show(XXX) {
    document.getElementById("abc").style.display = "block";
    // document.getElementById("file").value = XXX;
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