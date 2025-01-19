const elements = {
    "1": { "name": "H", "descriptor": "Hydrogen (H), Series: Nonmetal." },
    "2": { "name": "He", "descriptor": "Helium (He), Series: Noble gas." },
    "3": { "name": "Li", "descriptor": "Lithium (Li), Series: Alkali metal." },
    "4": { "name": "Be", "descriptor": "Beryllium (Be), Series: Alkaline earth metal." },
    "5": { "name": "B", "descriptor": "Boron (B), Series: Metalloid." },
    "6": { "name": "C", "descriptor": "Carbon (C), Series: Nonmetal." },
    "7": { "name": "N", "descriptor": "Nitrogen (N), Series: Nonmetal." },
    "8": { "name": "O", "descriptor": "Oxygen (O), Series: Nonmetal." },
    "9": { "name": "F", "descriptor": "Fluorine (F), Series: Halogen." },
    "10": { "name": "Ne", "descriptor": "Neon (Ne), Series: Noble gas." },
    "11": { "name": "Na", "descriptor": "Sodium (Na), Series: Alkali metal." },
    "12": { "name": "Mg", "descriptor": "Magnesium (Mg), Series: Alkaline earth metal." },
    "13": { "name": "Al", "descriptor": "Aluminum (Al), Series: Post-transition metal." },
    "14": { "name": "Si", "descriptor": "Silicon (Si), Series: Metalloid." },
    "15": { "name": "P", "descriptor": "Phosphorus (P), Series: Nonmetal." },
    "16": { "name": "S", "descriptor": "Sulfur (S), Series: Nonmetal." },
    "17": { "name": "Cl", "descriptor": "Chlorine (Cl), Series: Halogen." },
    "18": { "name": "Ar", "descriptor": "Argon (Ar), Series: Noble gas." },
    "19": { "name": "K", "descriptor": "Potassium (K), Series: Alkali metal." },
    "20": { "name": "Ca", "descriptor": "Calcium (Ca), Series: Alkaline earth metal." },
    "21": { "name": "Sc", "descriptor": "Scandium (Sc), Series: Transition metal." },
    "22": { "name": "Ti", "descriptor": "Titanium (Ti), Series: Transition metal." },
    "23": { "name": "V", "descriptor": "Vanadium (V), Series: Transition metal." },
    "24": { "name": "Cr", "descriptor": "Chromium (Cr), Series: Transition metal." },
    "25": { "name": "Mn", "descriptor": "Manganese (Mn), Series: Transition metal." },
    "26": { "name": "Fe", "descriptor": "Iron (Fe), Series: Transition metal." },
    "27": { "name": "Co", "descriptor": "Cobalt (Co), Series: Transition metal." },
    "28": { "name": "Ni", "descriptor": "Nickel (Ni), Series: Transition metal." },
    "29": { "name": "Cu", "descriptor": "Copper (Cu), Series: Transition metal." },
    "30": { "name": "Zn", "descriptor": "Zinc (Zn), Series: Transition metal." },
    "31": { "name": "Ga", "descriptor": "Gallium (Ga), Series: Post-transition metal." },
    "32": { "name": "Ge", "descriptor": "Germanium (Ge), Series: Metalloid." },
    "33": { "name": "As", "descriptor": "Arsenic (As), Series: Metalloid." },
    "34": { "name": "Se", "descriptor": "Selenium (Se), Series: Nonmetal." },
    "35": { "name": "Br", "descriptor": "Bromine (Br), Series: Halogen." },
    "36": { "name": "Kr", "descriptor": "Krypton (Kr), Series: Noble gas." },
    "37": { "name": "Rb", "descriptor": "Rubidium (Rb), Series: Alkali metal." },
    "38": { "name": "Sr", "descriptor": "Strontium (Sr), Series: Alkaline earth metal." },
    "39": { "name": "Y", "descriptor": "Yttrium (Y), Series: Transition metal." },
    "40": { "name": "Zr", "descriptor": "Zirconium (Zr), Series: Transition metal." },
    "41": { "name": "Nb", "descriptor": "Niobium (Nb), Series: Transition metal." },
    "42": { "name": "Mo", "descriptor": "Molybdenum (Mo), Series: Transition metal." },
    "43": { "name": "Tc", "descriptor": "Technetium (Tc), Series: Transition metal." },
    "44": { "name": "Ru", "descriptor": "Ruthenium (Ru), Series: Transition metal." },
    "45": { "name": "Rh", "descriptor": "Rhodium (Rh), Series: Transition metal." },
    "46": { "name": "Pd", "descriptor": "Palladium (Pd), Series: Transition metal." },
    "47": { "name": "Ag", "descriptor": "Silver (Ag), Series: Transition metal." },
    "48": { "name": "Cd", "descriptor": "Cadmium (Cd), Series: Transition metal." },
    "49": { "name": "In", "descriptor": "Indium (In), Series: Post-transition metal." },
    "50": { "name": "Sn", "descriptor": "Tin (Sn), Series: Post-transition metal." },
    "51": { "name": "Sb", "descriptor": "Antimony (Sb), Series: Metalloid." },
    "52": { "name": "Te", "descriptor": "Tellurium (Te), Series: Metalloid." },
    "53": { "name": "I", "descriptor": "Iodine (I), Series: Halogen." },
    "54": { "name": "Xe", "descriptor": "Xenon (Xe), Series: Noble gas." },
    "55": { "name": "Cs", "descriptor": "Cesium (Cs), Series: Alkali metal." },
    "56": { "name": "Ba", "descriptor": "Barium (Ba), Series: Alkaline earth metal." },
    "57": { "name": "La", "descriptor": "Lanthanum (La), Series: Lanthanide." },
    "58": { "name": "Ce", "descriptor": "Cerium (Ce), Series: Lanthanide." },
    "59": { "name": "Pr", "descriptor": "Praseodymium (Pr), Series: Lanthanide." },
    "60": { "name": "Nd", "descriptor": "Neodymium (Nd), Series: Lanthanide." },
    "61": { "name": "Pm", "descriptor": "Promethium (Pm), Series: Lanthanide." },
    "62": { "name": "Sm", "descriptor": "Samarium (Sm), Series: Lanthanide." },
    "63": { "name": "Eu", "descriptor": "Europium (Eu), Series: Lanthanide." },
    "64": { "name": "Gd", "descriptor": "Gadolinium (Gd), Series: Lanthanide." },
    "65": { "name": "Tb", "descriptor": "Terbium (Tb), Series: Lanthanide." },
    "66": { "name": "Dy", "descriptor": "Dysprosium (Dy), Series: Lanthanide." },
    "67": { "name": "Ho", "descriptor": "Holmium (Ho), Series: Lanthanide." },
    "68": { "name": "Er", "descriptor": "Erbium (Er), Series: Lanthanide." },
    "69": { "name": "Tm", "descriptor": "Thulium (Tm), Series: Lanthanide." },
    "70": { "name": "Yb", "descriptor": "Ytterbium (Yb), Series: Lanthanide." },
    "71": { "name": "Lu", "descriptor": "Lutetium (Lu), Series: Lanthanide." },
    "72": { "name": "Hf", "descriptor": "Hafnium (Hf), Series: Transition metal." },
    "73": { "name": "Ta", "descriptor": "Tantalum (Ta), Series: Transition metal." },
    "74": { "name": "W", "descriptor": "Tungsten (W), Series: Transition metal." },
    "75": { "name": "Re", "descriptor": "Rhenium (Re), Series: Transition metal." },
    "76": { "name": "Os", "descriptor": "Osmium (Os), Series: Transition metal." },
    "77": { "name": "Ir", "descriptor": "Iridium (Ir), Series: Transition metal." },
    "78": { "name": "Pt", "descriptor": "Platinum (Pt), Series: Transition metal." },
    "79": { "name": "Au", "descriptor": "Gold (Au), Series: Transition metal." },
    "80": { "name": "Hg", "descriptor": "Mercury (Hg), Series: Transition metal." },
    "81": { "name": "Tl", "descriptor": "Thallium (Tl), Series: Post-transition metal." },
    "82": { "name": "Pb", "descriptor": "Lead (Pb), Series: Post-transition metal." },
    "83": { "name": "Bi", "descriptor": "Bismuth (Bi), Series: Post-transition metal." },
    "84": { "name": "Po", "descriptor": "Polonium (Po), Series: Metalloid." },
    "85": { "name": "At", "descriptor": "Astatine (At), Series: Halogen." },
    "86": { "name": "Rn", "descriptor": "Radon (Rn), Series: Noble gas." },
    "87": { "name": "Fr", "descriptor": "Francium (Fr), Series: Alkali metal." },
    "88": { "name": "Ra", "descriptor": "Radium (Ra), Series: Alkaline earth metal." },
    "89": { "name": "Ac", "descriptor": "Actinium (Ac), Series: Actinide." },
    "90": { "name": "Th", "descriptor": "Thorium (Th), Series: Actinide." },
    "91": { "name": "Pa", "descriptor": "Protactinium (Pa), Series: Actinide." },
    "92": { "name": "U", "descriptor": "Uranium (U), Series: Actinide." },
    "93": { "name": "Np", "descriptor": "Neptunium (Np), Series: Actinide." },
    "94": { "name": "Pu", "descriptor": "Plutonium (Pu), Series: Actinide." },
    "95": { "name": "Am", "descriptor": "Americium (Am), Series: Actinide." },
    "96": { "name": "Cm", "descriptor": "Curium (Cm), Series: Actinide." },
    "97": { "name": "Bk", "descriptor": "Berkelium (Bk), Series: Actinide." },
    "98": { "name": "Cf", "descriptor": "Californium (Cf), Series: Actinide." },
    "99": { "name": "Es", "descriptor": "Einsteinium (Es), Series: Actinide." },
    "100": { "name": "Fm", "descriptor": "Fermium (Fm), Series: Actinide." },
    "101": { "name": "Md", "descriptor": "Mendelevium (Md), Series: Actinide." },
    "102": { "name": "No", "descriptor": "Nobelium (No), Series: Actinide." },
    "103": { "name": "Lr", "descriptor": "Lawrencium (Lr), Series: Actinide." },
    "104": { "name": "Rf", "descriptor": "Rutherfordium (Rf), Series: Transition metal." },
    "105": { "name": "Db", "descriptor": "Dubnium (Db), Series: Transition metal." },
    "106": { "name": "Sg", "descriptor": "Seaborgium (Sg), Series: Transition metal." },
    "107": { "name": "Bh", "descriptor": "Bohrium (Bh), Series: Transition metal." },
    "108": { "name": "Hs", "descriptor": "Hassium (Hs), Series: Transition metal." },
    "109": { "name": "Mt", "descriptor": "Meitnerium (Mt), Series: Transition metal." },
    "110": { "name": "Ds", "descriptor": "Darmstadtium (Ds), Series: Transition metal." },
    "111": { "name": "Rg", "descriptor": "Roentgenium (Rg), Series: Transition metal." },
    "112": { "name": "Cn", "descriptor": "Copernicium (Cn), Series: Transition metal." },
    "113": { "name": "Nh", "descriptor": "Nihonium (Nh), Series: Post-transition metal." },
    "114": { "name": "Fl", "descriptor": "Flerovium (Fl), Series: Post-transition metal." },
    "115": { "name": "Mc", "descriptor": "Moscovium (Mc), Series: Post-transition metal." },
    "116": { "name": "Lv", "descriptor": "Livermorium (Lv), Series: Post-transition metal." },
    "117": { "name": "Ts", "descriptor": "Tennessine (Ts), Series: Halogen." },
    "118": { "name": "Og", "descriptor": "Oganesson (Og), Series: Noble gas." }
}





class Compound{
    constructor(multiplier){
        this.elementList = [];
        this.multiplier = multiplier;
        this.totalElements = new Map();
    }
    AddElement(elementNo, amt){
        this.elementList.push([elementNo, amt]); 
        const current = this.totalElements.get(elementNo) || 0; 
        this.totalElements.set(elementNo, current + amt);
    }
}



document.addEventListener("DOMContentLoaded", function() {
    var equationSide = "Left";
    var currentElementAdding = 0;
    var currentCompoundLeft = -1;
    var currentCompoundRight = -1;
    const addElementButton = document.getElementById("addElementButton");
    const newCompoundButton = document.getElementById("newCompoundButton");
    const equationDisplay = document.getElementById("Equation");
    var amtAdding = 1;
    var EquationLeft = [];
    var EquationRight = [];

    const currentSideDisplay = document.getElementById("currentSideDisplay");
    const swapSideButton = document.getElementById("swapSideButton");
    swapSideButton.addEventListener("click", function() {
        if(equationSide == "Left"){
            equationSide = "Right";
        }else{
            equationSide = "Left";
        }
        currentSideDisplay.textContent = equationSide;
    });
    addElementButton.addEventListener("click", function() {
        if(equationSide == "Left"){
            if(currentCompoundLeft != -1){
                EquationLeft[currentCompoundLeft].AddElement(currentElementAdding, amtAdding);
                displayEquation();
            }
        }else{
            if(currentCompoundRight != -1){
                EquationRight[currentCompoundRight].AddElement(currentElementAdding, amtAdding);
                displayEquation();
            }
        }

    });
    newCompoundButton.addEventListener("click", function() {
        if(equationSide == "Left"){
            EquationLeft.push(new Compound(amtAdding));
            currentCompoundLeft++;
        }else{
            EquationRight.push(new Compound(amtAdding));
            currentCompoundRight++;
        }
        displayEquation();
    });
    function toSubscript(num) {
        const subscriptMap = {
            '0': '₀',
            '1': '₁',
            '2': '₂',
            '3': '₃',
            '4': '₄',
            '5': '₅',
            '6': '₆',
            '7': '₇',
            '8': '₈',
            '9': '₉'
        };
        return String(num)
            .split('')
            .map(digit => subscriptMap[digit])
            .join('');
    }
    function toSubscriptHTML(number) {
        return `<sub>${number}</sub>`;
    }
    
    function displayEquation(){
        sideAsString = "";
        EquationLeft.forEach(Compound => {
            let compoundAsString = "";
            if(Compound.multiplier != 1){
                compoundAsString += Compound.multiplier;
            }
            Compound.elementList.forEach(([elementNo, elAmt]) => {
                let elementAsString = "";
                elementAsString += elements[String(elementNo)].name;
                if(elAmt != 1){
                    elementAsString += toSubscriptHTML(elAmt);
                }
                compoundAsString += elementAsString;
            });
            sideAsString += (compoundAsString + " + ");
        });
        sideAsString = sideAsString.slice(0, -2);
        //later do the same for right equation when that is added
        let leftElementsTotal = new Map();
        let rightElementsTotal = new Map();
        EquationLeft.forEach(Compound => {
            for(let i = 0; i < 118; i++){
                if(Compound.totalElements.has(i)){
                    let current = leftElementsTotal.get(i) || 0;
                    leftElementsTotal.set(i, current + (Compound.totalElements.get(i) * Compound.multiplier));
                }
            }
        });
        EquationRight.forEach(Compound => {
            for(let i = 0; i < 118; i++){
                if(Compound.totalElements.has(i)){
                    let current = rightElementsTotal.get(i) || 0;
                    rightElementsTotal.set(i, current + (Compound.totalElements.get(i) * Compound.multiplier));
                }
            }
        });
        if(checkIfMapsAreEqual(rightElementsTotal, leftElementsTotal)){
            sideAsString += (" === ");
        }else{
            sideAsString += (" =X= ");
        }
        EquationRight.forEach(Compound => {
            let compoundAsString = "";
            if(Compound.multiplier != 1){
                compoundAsString += Compound.multiplier;
            }
            Compound.elementList.forEach(([elementNo, elAmt]) => {
                let elementAsString = "";
                elementAsString += elements[String(elementNo)].name;
                if(elAmt != 1){
                    elementAsString += toSubscriptHTML(elAmt);
                }
                compoundAsString += elementAsString;
            });
            sideAsString += (compoundAsString + " + ");
        });
        sideAsString = sideAsString.slice(0, -2);

        equationDisplay.innerHTML = sideAsString;

        rightODisplay.textContent = rightElementsTotal.get(8);
        leftODisplay.textContent = leftElementsTotal.get(8);

    }
    const rightODisplay = document.getElementById("rightOLevels");
    const leftODisplay = document.getElementById("leftOLevels");
    /*function checkIfMapsAreEqual(map1, map2) {
        if (map1.size != map2.size) return false;
        for (let [key, value] of map1) {
            if (map2.get(key) != value) return false;
        }
        return true;
    }*/
    function checkIfMapsAreEqual(map1, map2){
        if(map1.size == map2.size){
            for(let i = 0; i < 118; i++){
                let map1Contains;
                if(map1.has(i)){
                    map1Contains = true;
                }else{
                    map1Contains = false;
                }
                let map2Contains;
                if(map2.has(i)){
                    map2Contains = true;
                }else{
                    map2Contains = false;
                }
                if(map1Contains != map2Contains){
                    return false;
                }
                //^^ checks if both maps eithor contain or do not contain an element
                if(map1Contains == true){
                    if(map1.get(i) != map2.get(i)){
                        return false
                    }
                }
                //^^ checks if the value amt of an element is the same if the element is contained
            }
            return true;
        }else{
            return false;
        }
    }
    const amtDisplay = document.getElementById("amtDisplay");
    const increaseAmtButton = document.getElementById("increaseAmtButton");
    const decreaseAmtButton = document.getElementById("decreaseAmtButton");

    
    amtDisplay.textContent = amtAdding;
    increaseAmtButton.addEventListener("click", function(){
        amtAdding++;
        amtDisplay.textContent = amtAdding;
    });
    decreaseAmtButton.addEventListener("click", function(){
        if(amtAdding > 1){
            amtAdding--;
            amtDisplay.textContent = amtAdding;
        }
    });


    const currentElementDisplay = document.getElementById("currentElementDisplay");

    const hydrogenButton = document.getElementById("hydrogenButton");
    const carbonButton = document.getElementById("carbonButton");
    const oxygenButton = document.getElementById("oxygenButton");
    
    elementButton1.addEventListener("click", function() {

        currentElementAdding = 1;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton2.addEventListener("click", function() {

        currentElementAdding = 2;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton3.addEventListener("click", function() {

        currentElementAdding = 3;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton4.addEventListener("click", function() {

        currentElementAdding = 4;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton5.addEventListener("click", function() {

        currentElementAdding = 5;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton6.addEventListener("click", function() {
        currentElementAdding = 6;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton7.addEventListener("click", function() {

        currentElementAdding = 7;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton8.addEventListener("click", function() {
        currentElementAdding = 8;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton9.addEventListener("click", function() {

        currentElementAdding = 9;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton10.addEventListener("click", function() {

        currentElementAdding = 10;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton11.addEventListener("click", function() {

        currentElementAdding = 11;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton12.addEventListener("click", function() {

        currentElementAdding = 12;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton13.addEventListener("click", function() {

        currentElementAdding = 12;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton14.addEventListener("click", function() {

        currentElementAdding = 14;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton15.addEventListener("click", function() {

        currentElementAdding = 15;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton16.addEventListener("click", function() {

        currentElementAdding = 16;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton17.addEventListener("click", function() {

        currentElementAdding = 17;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton18.addEventListener("click", function() {

        currentElementAdding = 18;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton19.addEventListener("click", function() {

        currentElementAdding = 19;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton20.addEventListener("click", function() {

        currentElementAdding = 20;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton21.addEventListener("click", function() {

        currentElementAdding = 21;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton22.addEventListener("click", function() {

        currentElementAdding = 22;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton23.addEventListener("click", function() {

        currentElementAdding = 23;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton24.addEventListener("click", function() {

        currentElementAdding = 24;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton25.addEventListener("click", function() {

        currentElementAdding = 25;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton26.addEventListener("click", function() {

        currentElementAdding = 26;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton27.addEventListener("click", function() {

        currentElementAdding = 27;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton28.addEventListener("click", function() {

        currentElementAdding = 28;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton29.addEventListener("click", function() {

        currentElementAdding = 29;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton30.addEventListener("click", function() {

        currentElementAdding = 30;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton31.addEventListener("click", function() {

        currentElementAdding = 31;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton32.addEventListener("click", function() {

        currentElementAdding = 32;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton33.addEventListener("click", function() {

        currentElementAdding = 33;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton34.addEventListener("click", function() {

        currentElementAdding = 34;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton35.addEventListener("click", function() {

        currentElementAdding = 35;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton36.addEventListener("click", function() {

        currentElementAdding = 36;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton37.addEventListener("click", function() {

        currentElementAdding = 37;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton38.addEventListener("click", function() {

        currentElementAdding = 38;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton39.addEventListener("click", function() {

        currentElementAdding = 39;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton40.addEventListener("click", function() {

        currentElementAdding = 40;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton41.addEventListener("click", function() {

        currentElementAdding = 41;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton42.addEventListener("click", function() {

        currentElementAdding = 42;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton43.addEventListener("click", function() {

        currentElementAdding = 43;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton44.addEventListener("click", function() {

        currentElementAdding = 44;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton45.addEventListener("click", function() {

        currentElementAdding = 45;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton46.addEventListener("click", function() {

        currentElementAdding = 46;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton47.addEventListener("click", function() {

        currentElementAdding = 47;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton48.addEventListener("click", function() {

        currentElementAdding = 48;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton49.addEventListener("click", function() {

        currentElementAdding = 49;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton50.addEventListener("click", function() {

        currentElementAdding = 50;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton51.addEventListener("click", function() {

        currentElementAdding = 51;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton52.addEventListener("click", function() {

        currentElementAdding = 52;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton53.addEventListener("click", function() {

        currentElementAdding = 53;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton54.addEventListener("click", function() {

        currentElementAdding = 54;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton55.addEventListener("click", function() {

        currentElementAdding = 55;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton56.addEventListener("click", function() {

        currentElementAdding = 56;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton57.addEventListener("click", function() {

        currentElementAdding = 57;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton58.addEventListener("click", function() {

        currentElementAdding = 58;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton59.addEventListener("click", function() {

        currentElementAdding = 59;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton60.addEventListener("click", function() {

        currentElementAdding = 60;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton61.addEventListener("click", function() {

        currentElementAdding = 62;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton62.addEventListener("click", function() {

        currentElementAdding = 62;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton63.addEventListener("click", function() {

        currentElementAdding = 63;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton64.addEventListener("click", function() {

        currentElementAdding = 64;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton65.addEventListener("click", function() {

        currentElementAdding = 65;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton66.addEventListener("click", function() {

        currentElementAdding = 66;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton67.addEventListener("click", function() {

        currentElementAdding = 67;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton68.addEventListener("click", function() {

        currentElementAdding = 68;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton69.addEventListener("click", function() {

        currentElementAdding = 69;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton70.addEventListener("click", function() {

        currentElementAdding = 70;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton71.addEventListener("click", function() {

        currentElementAdding = 71;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton72.addEventListener("click", function() {

        currentElementAdding = 72;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton73.addEventListener("click", function() {

        currentElementAdding = 73;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton74.addEventListener("click", function() {

        currentElementAdding = 74;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton75.addEventListener("click", function() {

        currentElementAdding = 75;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton76.addEventListener("click", function() {

        currentElementAdding = 76;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton77.addEventListener("click", function() {

        currentElementAdding = 77;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton78.addEventListener("click", function() {

        currentElementAdding = 78;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton79.addEventListener("click", function() {

        currentElementAdding = 79;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton80.addEventListener("click", function() {

        currentElementAdding = 80;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton81.addEventListener("click", function() {

        currentElementAdding = 81;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton82.addEventListener("click", function() {

        currentElementAdding = 82;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton83.addEventListener("click", function() {

        currentElementAdding = 83;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton84.addEventListener("click", function() {

        currentElementAdding = 84;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton85.addEventListener("click", function() {

        currentElementAdding = 85;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton86.addEventListener("click", function() {

        currentElementAdding = 86;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton87.addEventListener("click", function() {

        currentElementAdding = 87;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton88.addEventListener("click", function() {

        currentElementAdding = 88;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton89.addEventListener("click", function() {

        currentElementAdding = 89;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton90.addEventListener("click", function() {

        currentElementAdding = 90;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton91.addEventListener("click", function() {

        currentElementAdding = 91;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton92.addEventListener("click", function() {

        currentElementAdding = 92;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton93.addEventListener("click", function() {

        currentElementAdding = 93;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton94.addEventListener("click", function() {

        currentElementAdding = 94;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton95.addEventListener("click", function() {

        currentElementAdding = 95;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton96.addEventListener("click", function() {

        currentElementAdding = 96;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton97.addEventListener("click", function() {

        currentElementAdding = 97;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton98.addEventListener("click", function() {

        currentElementAdding = 98;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton99.addEventListener("click", function() {

        currentElementAdding = 99;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton100.addEventListener("click", function() {

        currentElementAdding = 100;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton101.addEventListener("click", function() {

        currentElementAdding = 101;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton102.addEventListener("click", function() {

        currentElementAdding = 102;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton103.addEventListener("click", function() {

        currentElementAdding = 103;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton104.addEventListener("click", function() {

        currentElementAdding = 104;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton105.addEventListener("click", function() {

        currentElementAdding = 105;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton106.addEventListener("click", function() {

        currentElementAdding = 106;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton107.addEventListener("click", function() {

        currentElementAdding = 107;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton108.addEventListener("click", function() {

        currentElementAdding = 108;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton109.addEventListener("click", function() {

        currentElementAdding = 109;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton110.addEventListener("click", function() {

        currentElementAdding = 110;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton111.addEventListener("click", function() {

        currentElementAdding = 111;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton112.addEventListener("click", function() {

        currentElementAdding = 112;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton113.addEventListener("click", function() {

        currentElementAdding = 113;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton114.addEventListener("click", function() {

        currentElementAdding = 114;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton115.addEventListener("click", function() {

        currentElementAdding = 115;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton116.addEventListener("click", function() {

        currentElementAdding = 116;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton117.addEventListener("click", function() {

        currentElementAdding = 117;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
    elementButton118.addEventListener("click", function() {

        currentElementAdding = 118;
        currentElementDisplay.textContent = elements[currentElementAdding].descriptor;
    });
});