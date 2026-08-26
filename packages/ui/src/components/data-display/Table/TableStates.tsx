import Box from '@mui/material/Box/index.js';
import TableBody from '@mui/material/TableBody/index.js';
import TableCell from '@mui/material/TableCell/index.js';
import TableRow from '@mui/material/TableRow/index.js';
import React from 'react';


export const NoDataPlaceholder: React.FC<{ emptyText: string }> = ({ emptyText }) => (
  <Box py={4} color="text.secondary">
    {emptyText}
  </Box>
);

export const EmptyRow: React.FC<{ colSpan: number; children: React.ReactNode }> = ({
  colSpan,
  children }) => (
  <TableBody>
    <TableRow>
      <TableCell colSpan={colSpan} align="center">
        {children}
      </TableCell>
    </TableRow>
  </TableBody>
);
