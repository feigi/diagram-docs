package com.example;
import java.util.ArrayList;

interface Alpha {}
interface Beta {}
interface Gamma {}

interface Combined extends Alpha, Beta, Gamma {}

public class Bag extends ArrayList<String> implements Alpha, Comparable<Bag>, Beta {}
