# Juego en vivo · ¿Se puede anticipar quién abandona? (OULAD)

Votación anónima para la presentación final. La sala escanea un QR, responde
**“¿Abandonaste alguna materia en 2025?”** con Sí o No, y al cerrar la votación
dos modelos “predicen” quién abandonó **sin mirar ningún dato**:

| Modelo | Qué hace |
| --- | --- |
| **Al azar** | Dice “abandona” con probabilidad 31,2 % (la tasa de abandono de OULAD, diapositiva 5) |
| **Siempre “no”** | Dice que nadie abandona (el Dummy de la presentación) |

La pantalla muestra cuántos abandonaron y cuántos no, la matriz de confusión de cada
modelo y sus métricas (accuracy, recall y precision). Cada celular muestra qué respondió
esa persona, qué le predijo cada modelo y si acertó.

**Stack:** Node.js + Express + Socket.io · HTML, CSS y JavaScript sin frameworks.

## Qué se ve en el panel

- **Votación abierta:** QR grande, cantidad de respuestas en vivo y el botón **CERRAR Y PREDECIR**.
- **Resultados:**
  - Totales: abandonaron, no abandonaron y la tasa de la sala contra el 31,2 % de OULAD.
  - Matriz de confusión y métricas de los dos modelos, lado a lado. Filas = lo real; columnas = lo predicho (igual que la diapositiva 18).
  - Debajo del azar, el **promedio de 1.000 tiradas** con las mismas respuestas. Con 15 personas, una sola tirada puede tener suerte; el promedio muestra que el azar detecta alrededor del 31 %.
- **Volver a tirar el azar:** vuelve a sortear las predicciones con las mismas respuestas. Sirve para mostrar que el resultado del azar cambia cada vez.
- **Ver detalle anónimo:** tabla con el número interno de cada participante (#1, #2…), su respuesta y lo que le predijo cada modelo.
- **Nueva votación:** borra las respuestas y vuelve a abrir la votación.

Cada participante tiene un id interno (se guarda en su navegador). Si recarga la página o
se le bloquea el celular, vuelve con su respuesta. Puede cambiar la respuesta hasta el cierre.
Quien no respondió antes del cierre no entra en el análisis.

## Ejecutarlo en tu computadora

Requisito: [Node.js](https://nodejs.org) 18 o superior.

```bash
cd juego-abandono-oulad
npm install
npm start
```

La consola muestra la dirección para los participantes y el enlace del panel
(`/admin?key=…`). Al entrar, la clave desaparece de la barra de direcciones.
Si se usa en la red local, los celulares tienen que estar en el mismo Wi-Fi.

### Opciones (variables de entorno)

| Variable | Para qué sirve | Por defecto |
| --- | --- | --- |
| `ADMIN_KEY` | Clave del panel `/admin` | Una al azar, que se muestra en la consola |
| `PORT` | Puerto | `3000` |
| `PUBLIC_URL` | Dirección que muestra el QR | La que detecte |
| `BASE_RATE` | Probabilidad con la que el azar dice “abandona” | `0.312` |
| `QUESTION` | Texto de la pregunta | `¿Abandonaste alguna materia en 2025?` |

## Publicarlo en Render (gratis)

Igual que el crucigrama: subir la carpeta a un repositorio de GitHub (sin `node_modules`),
y en [render.com](https://render.com) elegir **New → Blueprint** con ese repositorio.
Render lee `render.yaml` y pide `ADMIN_KEY`.

**El día de la presentación:** el plan gratuito se duerme a los 15 minutos sin uso y tarda
alrededor de un minuto en despertar. Abrí el panel unos minutos antes y dejalo abierto.
Que la sala entre con datos móviles, sin depender del Wi-Fi.

## Eventos de Socket.io

| Evento | Dirección | Qué hace |
| --- | --- | --- |
| `join` | participante → servidor | Entra (o vuelve con su id guardado) |
| `answer` | participante → servidor | Envía Sí o No (se puede cambiar hasta el cierre) |
| `close_and_predict` | panel → servidor | Cierra la votación, sortea las predicciones y calcula los resultados |
| `reroll` | panel → servidor | Vuelve a sortear el modelo al azar |
| `reset` | panel → servidor → todos | Nueva votación |
| `state` | servidor → panel | Estado completo: conteos, resultados y detalle anónimo |
| `results` | servidor → cada participante | Resultado general y el suyo |
