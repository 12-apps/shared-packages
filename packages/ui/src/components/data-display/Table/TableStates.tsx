import { Box, TableBody, TableCell, TableRow } from '@mui/material';
import type { FC, ReactNode } from 'react';
import React from 'react';

import type { ColumnConfig } from './Table.types';

export const NoDataPlaceholder: React.FC = () => (
  <Box py={4} color="text.secondary">
    No data available
  </Box>
);

export const EmptyRow: React.FC<{ colSpan: number; children: React.ReactNode }> = ({
  colSpan,
  children,
}) => (
  <TableBody>
    <TableRow>
      <TableCell colSpan={colSpan} align="center">
        {children}
      </TableCell>
    </TableRow>
  </TableBody>
);
