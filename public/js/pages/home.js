// Simple animation example
const logo = document.getElementById('logo');

logo.addEventListener('mouseover', () => {
    logo.style.transform = 'scale(1.1)'; 
});

logo.addEventListener('mouseout', () => {
    logo.style.transform = 'scale(1)'; 
});
const appointmentButton = document.getElementById('appointmentButton');

appointmentButton.addEventListener('click', () => {
    window.location.href = 'simplified';
});
const searchButton = document.getElementById('searchButton');

searchButton.addEventListener('click', () => {
    window.location.href = 'search';
});