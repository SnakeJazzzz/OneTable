'use client';

import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { AlertStatus } from '@/core/alerts/classify';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertBadge } from './alert-badge';
import { useOneTable, type OneTableRow } from '@/lib/hooks/use-onetable';
import { cn } from '@/lib/utils';

const ALERT_OPTIONS: AlertStatus[] = [
  'SIN_STOCK',
  'CRITICO',
  'RIESGO',
  'ATENCION',
  'OK',
  'EXCESO',
  'SIN_DATOS',
];

const ALERT_LABEL_ES: Record<AlertStatus, string> = {
  SIN_STOCK: 'Sin stock',
  CRITICO: 'Crítico',
  RIESGO: 'Riesgo',
  ATENCION: 'Atención',
  OK: 'OK',
  EXCESO: 'Exceso',
  SIN_DATOS: 'Sin datos',
};

const PAGE_SIZE = 50;

const MXN_FORMAT = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

function fmtUnits(n: number | null): string {
  if (n === null) return '—';
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 }).format(n);
}

function fmtMxn(n: number | null): string {
  if (n === null) return '—';
  return MXN_FORMAT.format(n);
}

function fmtDays(n: number | null): string {
  if (n === null) return '—';
  return `${n.toFixed(1)} d`;
}

// CSV helper: escape commas/quotes/newlines, UTF-8 BOM for Excel-es compat.
function rowsToCsv(rows: OneTableRow[]): string {
  const headers = [
    'Cadena',
    'Tienda',
    'Producto',
    'Sin mapear',
    'Periodo',
    'Ventas U',
    'Ventas estimadas',
    'Ventas MXN',
    'Inventario U',
    'Dias Inv',
    'Alerta',
  ];
  const escape = (v: string): string => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const lines = [headers.map(escape).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.chain,
        r.storeName ?? r.storeId ?? '',
        r.productName,
        r.isUnmapped ? 'sí' : 'no',
        `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`,
        String(r.salesUnits ?? ''),
        r.salesUnitsEstimated ? 'sí' : 'no',
        r.salesAmountMxn === null ? '' : String(r.salesAmountMxn),
        String(r.inventoryUnits ?? ''),
        r.daysOfInventory === null ? '' : String(r.daysOfInventory),
        ALERT_LABEL_ES[r.alert],
      ]
        .map((v) => escape(String(v)))
        .join(','),
    );
  }
  return '﻿' + lines.join('\r\n');
}

function downloadBlob(data: BlobPart, mime: string, filename: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function OneTable({ periodKey }: { periodKey: string | undefined }) {
  const { rows, loading, error } = useOneTable(periodKey);

  // Filter state
  const [chain, setChain] = useState<string>('');
  const [store, setStore] = useState<string>('');
  const [sku, setSku] = useState<string>('');
  const [alertFilter, setAlertFilter] = useState<string>('');
  const [page, setPage] = useState(0);

  // Derived: unique chain + store options from the data
  const chainOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.chain);
    return Array.from(set).sort();
  }, [rows]);

  const storeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (chain && r.chain !== chain) continue;
      if (r.storeName) set.add(r.storeName);
      else if (r.storeId) set.add(r.storeId);
    }
    return Array.from(set).sort();
  }, [rows, chain]);

  const filtered = useMemo(() => {
    const skuLower = sku.trim().toLowerCase();
    return rows.filter((r) => {
      if (chain && r.chain !== chain) return false;
      if (store) {
        const s = r.storeName ?? r.storeId ?? '';
        if (s !== store) return false;
      }
      if (skuLower) {
        const hay = `${r.productName} ${r.portalRawProduct}`.toLowerCase();
        if (!hay.includes(skuLower)) return false;
      }
      if (alertFilter && r.alert !== alertFilter) return false;
      return true;
    });
  }, [rows, chain, store, sku, alertFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  function resetPage() {
    setPage(0);
  }

  function onExportCsv() {
    const csv = rowsToCsv(filtered);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(csv, 'text/csv;charset=utf-8', `onetable-${ts}.csv`);
  }

  function onExportXlsx() {
    const sheet = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
        Cadena: r.chain,
        Tienda: r.storeName ?? r.storeId ?? '',
        Producto: r.productName,
        'Sin mapear': r.isUnmapped ? 'sí' : 'no',
        Periodo: `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`,
        'Ventas U': r.salesUnits,
        'Ventas estimadas': r.salesUnitsEstimated ? 'sí' : 'no',
        'Ventas MXN': r.salesAmountMxn,
        'Inventario U': r.inventoryUnits,
        'Dias Inv': r.daysOfInventory,
        Alerta: ALERT_LABEL_ES[r.alert],
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'OneTable');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `onetable-${ts}.xlsx`,
    );
  }

  return (
    <section className="space-y-4">
      <Card className="p-5 space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Tabla consolidada</h3>
            <p className="text-xs text-muted-foreground">
              SKU × tienda × alerta para el período activo.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={onExportCsv}
              disabled={filtered.length === 0 || loading}
              className="gap-2"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              CSV
            </Button>
            <Button
              onClick={onExportXlsx}
              disabled={filtered.length === 0 || loading}
              className="gap-2"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Excel
            </Button>
          </div>
        </header>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Cadena</span>
            <select
              value={chain}
              onChange={(e) => {
                setChain(e.target.value);
                setStore('');
                resetPage();
              }}
              className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">Todas</option>
              {chainOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Tienda</span>
            <select
              value={store}
              onChange={(e) => {
                setStore(e.target.value);
                resetPage();
              }}
              className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">Todas</option>
              {storeOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">SKU</span>
            <Input
              type="search"
              placeholder="Buscar producto…"
              value={sku}
              onChange={(e) => {
                setSku(e.target.value);
                resetPage();
              }}
              className="h-9"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Alerta</span>
            <select
              value={alertFilter}
              onChange={(e) => {
                setAlertFilter(e.target.value);
                resetPage();
              }}
              className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">Todas</option>
              {ALERT_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {ALERT_LABEL_ES[a]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Table */}
        {error ? (
          <p
            role="alert"
            className="text-sm text-destructive-foreground bg-destructive/10 border border-destructive/40 rounded-md px-3 py-2"
          >
            {error}
          </p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? 'Sin datos en el período seleccionado.'
              : 'Ningún resultado con los filtros actuales.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Cadena</th>
                  <th className="px-3 py-2 text-left font-medium">Tienda</th>
                  <th className="px-3 py-2 text-left font-medium">Producto</th>
                  <th className="px-3 py-2 text-right font-medium">Ventas U</th>
                  <th className="px-3 py-2 text-right font-medium">Ventas MXN</th>
                  <th className="px-3 py-2 text-right font-medium">Inv U</th>
                  <th className="px-3 py-2 text-right font-medium">Días Inv</th>
                  <th className="px-3 py-2 text-left font-medium">Alerta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.map((r) => (
                  <tr key={r.id} className="hover:bg-accent/30">
                    <td className="px-3 py-2 text-foreground">{r.chain}</td>
                    <td className="px-3 py-2 text-muted-foreground" title={r.storeName ?? r.storeId ?? ''}>
                      <span className="block max-w-[200px] truncate">
                        {r.storeName ?? r.storeId ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      <span className="flex items-center gap-2">
                        <span className="block max-w-[260px] truncate" title={r.productName}>
                          {r.productName}
                        </span>
                        {r.isUnmapped && (
                          <span
                            className="inline-block rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-200"
                            title="Producto sin mapear"
                          >
                            sin mapear
                          </span>
                        )}
                        {r.salesUnitsEstimated && (
                          <span
                            className="inline-block rounded border border-blue-400/40 bg-blue-400/10 px-1.5 py-0.5 text-[10px] text-blue-200"
                            title="Ventas estimadas por el portal"
                          >
                            estimado
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {fmtUnits(r.salesUnits)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {fmtMxn(r.salesAmountMxn)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {fmtUnits(r.inventoryUnits)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {fmtDays(r.daysOfInventory)}
                    </td>
                    <td className="px-3 py-2">
                      <AlertBadge alert={r.alert} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer: pagination + count */}
        {filtered.length > 0 && (
          <footer className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
            <p className="text-muted-foreground">
              Mostrando {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, filtered.length)} de{' '}
              {filtered.length.toLocaleString('es-MX')} filas
              {rows.length !== filtered.length && (
                <span className="text-muted-foreground/70">
                  {' '}
                  · {rows.length.toLocaleString('es-MX')} sin filtros
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className={cn(
                  'h-8 px-3 rounded-md border border-border text-xs',
                  safePage === 0
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-accent transition-colors',
                )}
              >
                ← Anterior
              </button>
              <span className="text-xs text-muted-foreground">
                Página {safePage + 1} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className={cn(
                  'h-8 px-3 rounded-md border border-border text-xs',
                  safePage >= totalPages - 1
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-accent transition-colors',
                )}
              >
                Siguiente →
              </button>
            </div>
          </footer>
        )}
      </Card>
    </section>
  );
}
