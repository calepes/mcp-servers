# Achoradazos — Cobros y Juntes

**Estado:** Aprobado para especificación (Cal, 2026-08-27)

## Objetivo

Permitir que Jano consulte y cree grupos de cobro y juntes, y que registre depósitos solo después de que Cal elija explícitamente ambos registros.

## Modelo existente

- Un depósito enlaza `Fraterno`, `Concepto` y `Junte`.
- Una cuota mensual se asocia principalmente a `Grupo de Cobros`; puede financiar varias cosas.
- `Junte` en el depósito es referencia operativa. Los gastos se asocian directamente a su junte.
- No se agrega relación entre `Grupo de Cobros` y `Calendario Eventos`.

## Tools MCP

Se conservan `createConceptoCobro` y `createEvento`. Se agregan:

- `listGrupoCobros({ activos?: boolean })`: id, nombre, valor unitario, cantidad y activo.
- `listEventos({ desde?: string })`: id, nombre, fecha y lugar, ordenados por fecha descendente.

`getActiveConcepto` y `getActiveEvento` dejan de ser la ruta operativa para registrar depósitos; se conservan por compatibilidad.

## Flujo de depósito

1. Jano consulta grupos de cobro y juntes.
2. Muestra las opciones y pregunta a Cal cuál `conceptoId` y cuál `junteId` usar.
3. Solo con ambas elecciones explícitas sube la constancia y llama `registerDeposit`.

Nunca infiere ni selecciona automáticamente un concepto o junte.

## Integración y validación

- Agregar las dos tools al allowlist, mensajes de progreso y prompt de Jano.
- Compilar MCP y daemon Jano.
- Probar `tools/list`, ambas consultas contra Airtable y que el prompt exija confirmación antes de `registerDeposit`.
- No crear depósitos de prueba.

## Fuera de alcance

- Cambios de schema en Airtable.
- Reasignar depósitos históricos.
- Selección automática por fecha, estado o concepto activo.
