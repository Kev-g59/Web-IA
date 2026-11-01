/* =========================================================
   EXTASIS — app.js
   JavaScript puro (sin librerías). Organizado por módulos:
   1. Utilidades        5. Carrito (datos y persistencia)
   2. Menú móvil        6. Panel del carrito
   3. Contador          7. Validación de formularios
   4. Filtro            8. Arranque
   No hay servidor ni pagos: los pedidos y suscripciones
   son de demostración y lo dicen al usuario.
   ========================================================= */

'use strict';

/* ---------- 1. Utilidades ---------- */

// Fecha de cierre del drop: 31 de diciembre de 2026, 23:59:59 hora de Bogotá (UTC-5).
// Para probar el estado "Drop cerrado", cambia temporalmente esta fecha a una pasada.
const CIERRE_DROP = new Date('2026-12-31T23:59:59-05:00');

// Clave con la que el carrito se guarda en localStorage.
const CLAVE_CARRITO = 'extasis-carrito';

// Formatea números como pesos colombianos: 89000 -> "$ 89.000".
const formatoCOP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

// Atajos para seleccionar elementos.
const $ = (selector, contexto = document) => contexto.querySelector(selector);
const $$ = (selector, contexto = document) => [...contexto.querySelectorAll(selector)];

// Muestra un aviso breve (toast). role="status" hace que el lector de pantalla lo lea.
let temporizadorAviso;
function mostrarAviso(mensaje) {
  const aviso = $('[data-aviso]');
  aviso.textContent = mensaje;
  aviso.classList.add('is-visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => aviso.classList.remove('is-visible'), 3000);
}

/* ---------- 2. Menú móvil ---------- */

function iniciarMenu() {
  const boton = $('.nav-toggle');
  const lista = $('#menu-principal');

  function abrirOCerrar(abrir) {
    boton.setAttribute('aria-expanded', String(abrir));
    lista.classList.toggle('is-abierto', abrir);
  }

  boton.addEventListener('click', () => {
    const estaAbierto = boton.getAttribute('aria-expanded') === 'true';
    abrirOCerrar(!estaAbierto);
  });

  // Al elegir un enlace, el menú se cierra para dejar ver la sección.
  lista.addEventListener('click', (evento) => {
    if (evento.target.closest('a')) abrirOCerrar(false);
  });

  // Escape cierra el menú y devuelve el foco al botón.
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && boton.getAttribute('aria-expanded') === 'true') {
      abrirOCerrar(false);
      boton.focus();
    }
  });
}

/* ---------- 3. Contador del drop ---------- */

// Se consulta desde otros módulos para impedir compras con el drop cerrado.
function dropCerrado() {
  return Date.now() >= CIERRE_DROP.getTime();
}

function iniciarContador() {
  const contador = $('[data-contador]');
  const unidades = {
    dias: $('[data-unidad="dias"]', contador),
    horas: $('[data-unidad="horas"]', contador),
    minutos: $('[data-unidad="minutos"]', contador),
    segundos: $('[data-unidad="segundos"]', contador),
  };
  const textoAnuncio = $('[data-anuncio]');

  // Agrega un cero a la izquierda: 7 -> "07".
  const dosDigitos = (n) => String(n).padStart(2, '0');

  function actualizar() {
    const restante = CIERRE_DROP.getTime() - Date.now();

    // Al llegar a cero: mensaje de cierre, sin números negativos.
    if (restante <= 0) {
      clearInterval(intervalo);
      $('.contador__unidades', contador).hidden = true;
      $('#contador-titulo').hidden = true;
      $('[data-contador-cerrado]').hidden = false;
      textoAnuncio.textContent = 'Este drop ya cerró. Suscríbete para el próximo.';
      cerrarVentas();
      return;
    }

    const segundosTotales = Math.floor(restante / 1000);
    const dias = Math.floor(segundosTotales / 86400);
    const horas = Math.floor((segundosTotales % 86400) / 3600);
    const minutos = Math.floor((segundosTotales % 3600) / 60);
    const segundos = segundosTotales % 60;

    unidades.dias.textContent = dosDigitos(dias);
    unidades.horas.textContent = dosDigitos(horas);
    unidades.minutos.textContent = dosDigitos(minutos);
    unidades.segundos.textContent = dosDigitos(segundos);
    textoAnuncio.textContent = `Cierra en ${dias} d ${horas} h ${minutos} min`;
  }

  const intervalo = setInterval(actualizar, 1000);
  actualizar(); // primera actualización inmediata, sin esperar un segundo
}

// Desactiva todos los botones de compra cuando el drop cierra.
function cerrarVentas() {
  $$('.producto__form button, .producto__form select').forEach((control) => {
    control.disabled = true;
  });
  $('[data-ir-pedido]').disabled = true;
}

/* ---------- 4. Filtro por categoría ---------- */

function iniciarFiltro() {
  const botones = $$('[data-filtro]');
  const items = $$('.productos__item');

  botones.forEach((boton) => {
    boton.addEventListener('click', () => {
      const filtro = boton.dataset.filtro;

      // Solo un chip activo a la vez.
      botones.forEach((b) => b.setAttribute('aria-pressed', String(b === boton)));

      // hidden oculta el producto visualmente y para el lector de pantalla.
      items.forEach((item) => {
        item.hidden = filtro !== 'todos' && item.dataset.categoria !== filtro;
      });
    });
  });
}

/* ---------- 5. Carrito: datos y persistencia ---------- */

// Catálogo construido a partir de los atributos data-* del HTML.
// Ejemplo: catalogo['tote-mapa'] -> { nombre, precio, stock, img, ... }
const catalogo = {};

// Cada línea del carrito: { id, talla, cantidad }.
// Un mismo producto en dos tallas ocupa dos líneas distintas.
let carrito = [];

function leerCatalogo() {
  $$('.producto').forEach((articulo) => {
    const d = articulo.dataset;
    catalogo[d.id] = {
      id: d.id,
      nombre: d.nombre,
      precio: Number(d.precio),
      stock: Number(d.stock),
      tieneTallas: d.tallas === 'si',
      img: d.img,
      articulo,
    };
  });
}

// Unidades de un producto en el carrito, sumando todas sus tallas.
function unidadesEnCarrito(id) {
  return carrito
    .filter((linea) => linea.id === id)
    .reduce((suma, linea) => suma + linea.cantidad, 0);
}

function guardarCarrito() {
  try {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito));
  } catch (error) {
    // Puede fallar en modo privado; el carrito sigue funcionando sin guardarse.
    console.warn('No se pudo guardar el carrito:', error);
  }
}

function cargarCarrito() {
  let guardado = [];
  try {
    guardado = JSON.parse(localStorage.getItem(CLAVE_CARRITO)) || [];
  } catch (error) {
    guardado = []; // datos dañados: se empieza con el carrito vacío
  }
  if (!Array.isArray(guardado)) guardado = [];

  // Se descartan productos inexistentes y se recortan cantidades que superan el stock.
  carrito = [];
  guardado.forEach((linea) => {
    const producto = catalogo[linea?.id];
    const cantidad = Math.floor(Number(linea?.cantidad));
    if (!producto || !(cantidad > 0)) return;
    const disponible = producto.stock - unidadesEnCarrito(producto.id);
    if (disponible <= 0) return;
    carrito.push({
      id: producto.id,
      talla: producto.tieneTallas ? String(linea.talla || '') : 'Única',
      cantidad: Math.min(cantidad, disponible),
    });
  });
  guardarCarrito();
}

function agregarAlCarrito(id, talla) {
  const producto = catalogo[id];
  if (unidadesEnCarrito(id) >= producto.stock) {
    mostrarAviso(`No quedan más unidades de ${producto.nombre}.`);
    return;
  }
  const existente = carrito.find((l) => l.id === id && l.talla === talla);
  if (existente) {
    existente.cantidad += 1;
  } else {
    carrito.push({ id, talla, cantidad: 1 });
  }
  guardarCarrito();
  renderizarCarrito();
  const detalle = producto.tieneTallas ? `, talla ${talla}` : '';
  mostrarAviso(`Agregado: ${producto.nombre}${detalle}.`);
}

function cambiarCantidad(indice, cambio) {
  const linea = carrito[indice];
  if (!linea) return;
  const producto = catalogo[linea.id];
  if (cambio > 0 && unidadesEnCarrito(linea.id) >= producto.stock) return;
  linea.cantidad += cambio;
  if (linea.cantidad <= 0) carrito.splice(indice, 1);
  guardarCarrito();
  renderizarCarrito();
}

function eliminarLinea(indice) {
  const linea = carrito[indice];
  if (!linea) return;
  carrito.splice(indice, 1);
  guardarCarrito();
  renderizarCarrito();
  mostrarAviso(`Eliminado: ${catalogo[linea.id].nombre}.`);
}

function totalCarrito() {
  return carrito.reduce((suma, l) => suma + catalogo[l.id].precio * l.cantidad, 0);
}

// Actualiza el texto "Quedan N unidades" de cada tarjeta.
function actualizarStockVisible() {
  Object.values(catalogo).forEach((producto) => {
    const texto = $('[data-stock-texto]', producto.articulo);
    if (producto.stock === 0) {
      producto.articulo.classList.add('producto--agotado');
      texto.textContent = 'Agotado';
      return;
    }
    const enCarrito = unidadesEnCarrito(producto.id);
    const sufijo = enCarrito > 0 ? ` (${enCarrito} en tu carrito)` : '';
    texto.textContent = `Quedan ${producto.stock} unidades${sufijo}`;
    texto.classList.toggle('is-bajo', producto.stock <= 5);
  });
}

// Dibuja la lista del carrito a partir del arreglo `carrito`.
function renderizarCarrito() {
  const lista = $('[data-carrito-lista]');
  const unidades = carrito.reduce((suma, l) => suma + l.cantidad, 0);
  const total = formatoCOP.format(totalCarrito());

  lista.innerHTML = '';
  carrito.forEach((linea, indice) => {
    const producto = catalogo[linea.id];
    const sinMasStock = unidadesEnCarrito(linea.id) >= producto.stock;
    const etiqueta = `${producto.nombre}${producto.tieneTallas ? ` talla ${linea.talla}` : ''}`;

    const item = document.createElement('li');
    item.className = 'linea';
    // Se usa textContent para los datos y no se insertan valores del usuario como HTML.
    item.innerHTML = `
      <img class="linea__img" src="${producto.img}" alt="" width="64" height="64">
      <div class="linea__info">
        <p class="linea__nombre"></p>
        <p class="linea__detalle"></p>
        <div class="linea__controles">
          <button class="linea__btn" type="button" data-accion="restar" data-indice="${indice}">−</button>
          <span class="linea__cantidad">${linea.cantidad}</span>
          <button class="linea__btn" type="button" data-accion="sumar" data-indice="${indice}" ${sinMasStock ? 'disabled' : ''}>+</button>
          <button class="btn-texto linea__eliminar" type="button" data-accion="eliminar" data-indice="${indice}">Eliminar</button>
        </div>
      </div>`;
    $('.linea__nombre', item).textContent = producto.nombre;
    $('.linea__detalle', item).textContent =
      `${producto.tieneTallas ? `Talla ${linea.talla} · ` : ''}${formatoCOP.format(producto.precio)} c/u`;
    $('[data-accion="restar"]', item).setAttribute('aria-label', `Quitar una unidad de ${etiqueta}`);
    $('[data-accion="sumar"]', item).setAttribute('aria-label', `Agregar una unidad de ${etiqueta}`);
    $('[data-accion="eliminar"]', item).setAttribute('aria-label', `Eliminar ${etiqueta} del carrito`);
    lista.appendChild(item);
  });

  $('[data-carrito-vacio]').hidden = carrito.length > 0;
  $('[data-carrito-total]').textContent = total;
  $('[data-pedido-total]').textContent = total;
  $('[data-contador-carrito]').textContent = unidades;
  $('[data-ir-pedido]').disabled = carrito.length === 0 || dropCerrado();
  actualizarStockVisible();
}

function iniciarCarrito() {
  leerCatalogo();
  cargarCarrito();
  renderizarCarrito();

  // Un solo listener para todos los formularios "Agregar al carrito".
  $$('.producto__form').forEach((form) => {
    form.addEventListener('submit', (evento) => {
      evento.preventDefault();
      const id = form.closest('.producto').dataset.id;
      const producto = catalogo[id];
      if (dropCerrado()) return;

      let talla = 'Única';
      if (producto.tieneTallas) {
        const select = $('select', form);
        if (!select.value) {
          mostrarError(select, 'Elige una talla antes de agregar.');
          select.focus();
          return;
        }
        limpiarError(select);
        talla = select.value;
      }
      agregarAlCarrito(id, talla);
    });
  });

  // Delegación de eventos: un listener en la lista atiende todos los botones de las líneas.
  $('[data-carrito-lista]').addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-accion]');
    if (!boton) return;
    const indice = Number(boton.dataset.indice);
    if (boton.dataset.accion === 'sumar') cambiarCantidad(indice, 1);
    if (boton.dataset.accion === 'restar') cambiarCantidad(indice, -1);
    if (boton.dataset.accion === 'eliminar') eliminarLinea(indice);
  });

  // Si el carrito se modifica en otra pestaña, esta se actualiza.
  window.addEventListener('storage', (evento) => {
    if (evento.key === CLAVE_CARRITO) {
      cargarCarrito();
      renderizarCarrito();
    }
  });
}

/* ---------- 6. Panel del carrito ---------- */

let botonQueAbrio = null;

function mostrarVista(nombre) {
  $$('.carrito__vista').forEach((vista) => {
    vista.hidden = vista.dataset.vista !== nombre;
  });
}

function abrirCarrito() {
  botonQueAbrio = document.activeElement;
  mostrarVista('lista');
  $('#carrito').hidden = false;
  $('.carrito-fondo').hidden = false;
  $('.carrito-toggle').setAttribute('aria-expanded', 'true');
  document.body.classList.add('sin-scroll');
  // inert: el resto de la página deja de recibir foco y clics mientras el panel está abierto.
  $$('.site-header, main, .site-footer').forEach((el) => { el.inert = true; });
  $('#carrito [data-cerrar-carrito]').focus();
}

function cerrarCarrito() {
  if ($('#carrito').hidden) return;
  $('#carrito').hidden = true;
  $('.carrito-fondo').hidden = true;
  $('.carrito-toggle').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('sin-scroll');
  $$('.site-header, main, .site-footer').forEach((el) => { el.inert = false; });
  // El foco vuelve al botón que abrió el panel.
  (botonQueAbrio || $('.carrito-toggle')).focus();
}

function iniciarPanelCarrito() {
  $('.carrito-toggle').addEventListener('click', abrirCarrito);

  $$('[data-cerrar-carrito]').forEach((el) => el.addEventListener('click', cerrarCarrito));

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') cerrarCarrito();
  });

  $('[data-ir-pedido]').addEventListener('click', () => {
    mostrarVista('pedido');
    $('#ped-nombre').focus();
  });

  $('[data-volver-lista]').addEventListener('click', () => {
    mostrarVista('lista');
    $('[data-ir-pedido]').focus();
  });
}

/* ---------- 7. Validación de formularios ---------- */

// Reglas por nombre de campo. Cada regla devuelve '' si el valor es válido,
// o el mensaje de error que se mostrará al usuario.
const reglas = {
  nombre(valor) {
    const limpio = valor.trim();
    if (limpio.length < 2) return 'Escribe tu nombre (mínimo 2 letras).';
    if (/\d/.test(limpio)) return 'El nombre no debe contener números.';
    return '';
  },
  correo(valor) {
    const patron = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return patron.test(valor.trim()) ? '' : 'Escribe un correo válido, por ejemplo nombre@correo.com.';
  },
  talla(valor) {
    return valor ? '' : 'Elige una talla.';
  },
  acepto(_valor, campo) {
    return campo.checked ? '' : 'Debes aceptar recibir avisos para suscribirte.';
  },
  celular(valor) {
    const soloDigitos = valor.replace(/\s/g, '');
    return /^3\d{9}$/.test(soloDigitos)
      ? ''
      : 'Escribe un celular colombiano de 10 dígitos que empiece por 3, por ejemplo 3001234567.';
  },
  ciudad(valor) {
    return valor.trim().length >= 2 ? '' : 'Escribe tu ciudad.';
  },
  direccion(valor) {
    return valor.trim().length >= 8 ? '' : 'Escribe una dirección completa (mínimo 8 caracteres).';
  },
};

function mostrarError(campo, mensaje) {
  const error = document.getElementById(`${campo.id}-error`);
  campo.setAttribute('aria-invalid', 'true');
  if (error) {
    error.textContent = mensaje;
    error.hidden = false;
  }
}

function limpiarError(campo) {
  const error = document.getElementById(`${campo.id}-error`);
  campo.removeAttribute('aria-invalid');
  if (error) {
    error.textContent = '';
    error.hidden = true;
  }
}

// Valida un campo según su regla. Devuelve true si es válido.
function validarCampo(campo) {
  const regla = reglas[campo.name];
  if (!regla) return true; // campos opcionales sin regla (por ejemplo, notas)
  const mensaje = regla(campo.value, campo);
  if (mensaje) {
    mostrarError(campo, mensaje);
    return false;
  }
  limpiarError(campo);
  return true;
}

// Valida todo el formulario; enfoca el primer campo con error.
function validarFormulario(form) {
  const campos = $$('input, select, textarea', form);
  const invalidos = campos.filter((campo) => !validarCampo(campo));
  if (invalidos.length > 0) invalidos[0].focus();
  return invalidos.length === 0;
}

// Validación mientras el usuario escribe: al salir de un campo
// y, si ya tenía error, en cada cambio para que el error desaparezca al corregirlo.
function activarValidacionEnVivo(form) {
  $$('input, select, textarea', form).forEach((campo) => {
    campo.addEventListener('blur', () => validarCampo(campo));
    campo.addEventListener('input', () => {
      if (campo.getAttribute('aria-invalid') === 'true') validarCampo(campo);
    });
    campo.addEventListener('change', () => {
      if (campo.getAttribute('aria-invalid') === 'true') validarCampo(campo);
    });
  });
}

function iniciarSuscripcion() {
  const form = $('#form-suscripcion');
  const estado = $('[data-estado]', form);
  activarValidacionEnVivo(form);

  form.addEventListener('submit', (evento) => {
    evento.preventDefault(); // nunca se envía a un servidor
    estado.className = 'formulario__estado';
    if (!validarFormulario(form)) {
      estado.textContent = 'Revisa los campos marcados en rojo.';
      estado.classList.add('is-error');
      return;
    }
    const nombre = form.elements.nombre.value.trim();
    const correo = form.elements.correo.value.trim();
    estado.textContent =
      `¡Listo, ${nombre}! Te avisaríamos del próximo drop en ${correo}. ` +
      '(Demostración: no se envió ningún correo.)';
    estado.classList.add('is-exito');
    form.reset();
  });
}

function iniciarPedido() {
  const form = $('#form-pedido');
  activarValidacionEnVivo(form);

  form.addEventListener('submit', (evento) => {
    evento.preventDefault(); // no hay servidor ni cobro
    if (carrito.length === 0 || dropCerrado()) return;
    if (!validarFormulario(form)) return;

    const unidades = carrito.reduce((suma, l) => suma + l.cantidad, 0);
    const total = formatoCOP.format(totalCarrito());
    const nombre = form.elements.nombre.value.trim();

    const confirmacion = $('[data-confirmacion]');
    confirmacion.textContent =
      `Gracias, ${nombre}. Registramos ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'} ` +
      `por ${total}. Este es un proyecto académico: no se procesó ningún pago ` +
      'y no se enviará ningún producto.';

    // El pedido de demostración vacía el carrito.
    carrito = [];
    guardarCarrito();
    renderizarCarrito();
    form.reset();
    mostrarVista('confirmacion');
    confirmacion.focus();
  });
}

/* ---------- 8. Arranque ---------- */

// Con defer, el HTML ya está listo cuando se ejecuta este archivo.
iniciarMenu();
iniciarCarrito();
iniciarPanelCarrito();
iniciarContador();
iniciarFiltro();
iniciarSuscripcion();
iniciarPedido();
