import type {
  ColumnMetadata, IDiagramForeignKey, TableMetadata,
} from '../api-types';

/** Infers human-readable descriptions from column names and FK patterns. */
export class DescriptionInferrer {
  inferTableDescription(
    table: TableMetadata,
    fks: IDiagramForeignKey[],
    reverseFks: IDiagramForeignKey[],
  ): string {
    const parts: string[] = [];

    if (reverseFks.length > 3) {
      parts.push(
        `Core entity referenced by ${reverseFks.length} other tables.`,
      );
    } else if (fks.length === 0 && reverseFks.length === 0) {
      parts.push('Standalone table with no foreign key relationships.');
    } else if (fks.length > 0 && reverseFks.length === 0) {
      const parents = [...new Set(fks.map(f => f.toTable))];
      parts.push(`Leaf table linked to ${parents.join(', ')}.`);
    }

    const colNames = table.columns.map(c => c.name.toLowerCase());
    if (colNames.some(n => /email|password|auth|login/.test(n))) {
      parts.push('Contains authentication data.');
    }
    if (colNames.some(n => /price|total|amount|cost/.test(n))) {
      parts.push('Contains financial/pricing data.');
    }
    if (colNames.some(n => /created_at|updated_at|timestamp/.test(n))) {
      parts.push('Includes temporal tracking.');
    }
    if (colNames.some(n => /lat|lng|longitude|latitude|geo/.test(n))) {
      parts.push('Contains geolocation data.');
    }

    return parts.join(' ') || `Stores ${table.name.replace(/_/g, ' ')} data.`;
  }

  inferColumnDescription(
    col: ColumnMetadata,
    fk?: IDiagramForeignKey,
  ): string {
    if (col.pk) {
      return 'Primary key.';
    }
    if (fk) {
      return `Foreign key → ${fk.toTable}.${fk.toColumn}.`;
    }

    const name = col.name.toLowerCase();
    if (/created_at|created_date/.test(name)) {
      return 'Timestamp of record creation.';
    }
    if (/updated_at|modified_at/.test(name)) {
      return 'Timestamp of last modification.';
    }
    if (/deleted_at/.test(name)) {
      return 'Soft-delete timestamp (null = active).';
    }
    if (/^is_|^has_|^can_/.test(name)) {
      return 'Boolean flag.';
    }
    if (/email/.test(name)) {
      return 'Email address.';
    }
    if (/phone/.test(name)) {
      return 'Phone number.';
    }
    if (/password|pwd/.test(name)) {
      return 'Hashed password.';
    }

    return '';
  }
}
